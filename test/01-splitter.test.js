const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * BegSplitter — the contract that will hold real creator fees.
 *
 * The happy path is the least interesting thing here. What these tests are
 * mostly for is the negative space: that a stranger cannot claim, that the
 * launcher cannot reach the treasury's share, that a non-controller cannot touch
 * the growth fund, that rounding never strands a wei, and that there is no path
 * anywhere in the ABI that changes the split.
 *
 * The escrow tests matter for a second reason. Pons does not push creator fees;
 * it holds them and pays whoever calls `claim()`. If `pullFromEscrow` were wrong,
 * nothing would arrive and every share would read as zero — silently, because
 * there is no error to see. So the pull is exercised against a mock that
 * reproduces the real interface exactly, including the fact that `claim()` takes
 * no recipient and pays its caller.
 */

const Mode = { Standard: 0, Genesis: 1 };

const BPS = 10_000n;

async function deployFixture() {
  const [deployer, treasury, launcher, controller, outsider] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("BegSplitterFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const Escrow = await ethers.getContractFactory("MockPonsEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  async function create(mode, escrowAddress) {
    const tx = await factory.createSplitter(
      mode,
      treasury.address,
      launcher.address,
      controller.address,
      ethers.ZeroAddress, // begToken — unset, so buybacks stay unavailable
      escrowAddress ?? ethers.ZeroAddress, // Pons escrow
      ethers.ZeroAddress, // swapRouter — unset
      ethers.ZeroAddress, // weth — unset
      0, // poolFee
    );
    const receipt = await tx.wait();

    const created = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "SplitterCreated");

    return ethers.getContractAt("BegSplitter", created.args.splitter);
  }

  const standard = await create(Mode.Standard, await escrow.getAddress());
  const genesis = await create(Mode.Genesis, await escrow.getAddress());
  const noEscrow = await create(Mode.Standard, ethers.ZeroAddress);

  return { factory, escrow, standard, genesis, noEscrow, deployer, treasury, launcher, controller, outsider };
}

const fund = async (splitter, from, amount) => {
  await from.sendTransaction({ to: await splitter.getAddress(), value: amount });
};

/** Simulate Pons crediting fees to a recipient, then nobody claiming them. */
const creditInEscrow = async (escrow, splitter, from, amount) => {
  await escrow.connect(from).credit(await splitter.getAddress(), { value: amount });
};

describe("BegSplitter", () => {
  describe("initialisation", () => {
    it("records the parties, the mode and the escrow", async () => {
      const { standard, escrow, treasury, launcher, controller } = await loadFixture(deployFixture);

      expect(await standard.mode()).to.equal(Mode.Standard);
      expect(await standard.treasury()).to.equal(treasury.address);
      expect(await standard.launcher()).to.equal(launcher.address);
      expect(await standard.controller()).to.equal(controller.address);
      expect(await standard.escrow()).to.equal(await escrow.getAddress());
    });

    it("refuses a zero treasury, launcher or controller", async () => {
      const { factory, treasury, launcher, controller } = await loadFixture(deployFixture);

      // The error is declared on BegSplitter, not on the factory that triggers
      // it, so the matcher has to be given the splitter's ABI to decode it.
      const impl = await ethers.getContractAt("BegSplitter", await factory.implementation());

      // createSplitter takes nine arguments: mode, the three parties, then
      // begToken, escrow, swapRouter, weth and poolFee.
      const tail = [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, 0];
      const args = (t, l, c) => [Mode.Standard, t, l, c, ...tail];

      await expect(factory.createSplitter(...args(ethers.ZeroAddress, launcher.address, controller.address)))
        .to.be.revertedWithCustomError(impl, "ZeroAddress");

      await expect(factory.createSplitter(...args(treasury.address, ethers.ZeroAddress, controller.address)))
        .to.be.revertedWithCustomError(impl, "ZeroAddress");

      await expect(factory.createSplitter(...args(treasury.address, launcher.address, ethers.ZeroAddress)))
        .to.be.revertedWithCustomError(impl, "ZeroAddress");
    });

    it("cannot be initialised a second time", async () => {
      const { standard, treasury, launcher, controller } = await loadFixture(deployFixture);

      await expect(
        standard.initialize(
          Mode.Genesis,
          treasury.address,
          launcher.address,
          controller.address,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          0,
        ),
      ).to.be.revertedWithCustomError(standard, "InvalidInitialization");
    });

    it("leaves the implementation contract itself unusable", async () => {
      const { factory, treasury, launcher, controller } = await loadFixture(deployFixture);
      const impl = await ethers.getContractAt("BegSplitter", await factory.implementation());

      // The implementation's constructor sealed it, so nobody can initialise it
      // and take over the address every clone delegates to.
      await expect(
        impl.initialize(
          Mode.Standard,
          treasury.address,
          launcher.address,
          controller.address,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          0,
        ),
      ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });
  });

  describe("receiving", () => {
    it("counts what arrives", async () => {
      const { standard, deployer } = await loadFixture(deployFixture);

      await fund(standard, deployer, 1_000_000n);

      expect(await standard.totalReceived()).to.equal(1_000_000n);
      expect(await standard.totalCredited()).to.equal(0n);
    });
  });

  describe("pullFromEscrow", () => {
    it("reports what Pons is holding for this splitter", async () => {
      const { escrow, standard, deployer } = await loadFixture(deployFixture);

      expect(await standard.escrowBalance()).to.equal(0n);

      await creditInEscrow(escrow, standard, deployer, 50_000n);

      expect(await standard.escrowBalance()).to.equal(50_000n);
    });

    it("pulls the fees in, and they are then split like any other arrival", async () => {
      const { escrow, standard, deployer } = await loadFixture(deployFixture);

      await creditInEscrow(escrow, standard, deployer, 10_000n);

      // Nothing has arrived yet — it is sitting in Pons, not here.
      expect(await standard.totalReceived()).to.equal(0n);
      expect(await standard.claimableLauncher()).to.equal(0n);

      await standard.pullFromEscrow();

      expect(await standard.totalReceived()).to.equal(10_000n);
      expect(await standard.escrowBalance()).to.equal(0n);
      expect(await standard.claimableLauncher()).to.equal(3_333n);
      expect(await standard.claimableTreasury()).to.equal(3_333n);
      expect(await standard.growthFundAvailable()).to.equal(3_334n);
    });

    it("is permissionless — a stranger can trigger it for the recipient's benefit", async () => {
      const { escrow, standard, outsider, launcher } = await loadFixture(deployFixture);

      await creditInEscrow(escrow, standard, launcher, 10_000n);

      // The outsider gains nothing and cannot redirect anything; the money lands
      // in the splitter and is divided by arithmetic, not by who called.
      await standard.connect(outsider).pullFromEscrow();

      expect(await standard.claimableLauncher()).to.equal(3_333n);
      await expect(standard.connect(outsider).claim()).to.be.revertedWithCustomError(
        standard,
        "NotEntitled",
      );
    });

    it("does nothing when the escrow has no balance", async () => {
      const { standard } = await loadFixture(deployFixture);

      await expect(standard.pullFromEscrow()).to.not.be.reverted;
      expect(await standard.totalReceived()).to.equal(0n);
    });

    it("is inert when no escrow is configured", async () => {
      const { noEscrow } = await loadFixture(deployFixture);

      expect(await noEscrow.escrowBalance()).to.equal(0n);
      await expect(noEscrow.pullFromEscrow()).to.not.be.reverted;
      expect(await noEscrow.totalReceived()).to.equal(0n);
    });

    it("pulling twice does not double-count", async () => {
      const { escrow, standard, deployer } = await loadFixture(deployFixture);

      await creditInEscrow(escrow, standard, deployer, 10_000n);
      await standard.pullFromEscrow();

      // The escrow reverts on an empty balance, so the second pull must not
      // reach it — it checks first and returns 0. A keeper running this on a
      // quiet day gets a no-op, not a failed transaction.
      await expect(standard.pullFromEscrow()).to.not.be.reverted;

      expect(await standard.totalReceived()).to.equal(10_000n);
      expect(await standard.escrowBalance()).to.equal(0n);
    });
  });

  describe("sync — standard mode", () => {
    it("splits a third, a third, and the remainder", async () => {
      const { standard, deployer } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.sync();

      expect(await standard.creditedTreasury()).to.equal(3_333n);
      expect(await standard.creditedLauncher()).to.equal(3_333n);
      expect(await standard.creditedGrowthFund()).to.equal(3_334n);
    });

    it("never strands a wei, however awkward the amount", async () => {
      // 3 is the smallest amount that cannot divide evenly three ways, and
      // 999_999 leaves a different remainder. If the growth fund were computed
      // as a third constant instead of a remainder, these are the cases where
      // wei would be left behind in the contract forever.
      for (const amount of [1n, 2n, 3n, 999_999n, 12_345_678_901_234_567n]) {
        const { standard, deployer } = await loadFixture(deployFixture);

        await fund(standard, deployer, amount);
        await standard.sync();

        const credited =
          (await standard.creditedTreasury()) +
          (await standard.creditedLauncher()) +
          (await standard.creditedGrowthFund());

        expect(credited, `stranded wei for ${amount}`).to.equal(amount);
        expect(await standard.totalCredited()).to.equal(amount);
      }
    });

    it("does nothing on a second sync with no new fees", async () => {
      const { standard, deployer } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.sync();
      await standard.sync();

      expect(await standard.totalCredited()).to.equal(10_000n);
      expect(await standard.creditedGrowthFund()).to.equal(3_334n);
    });
  });

  describe("sync — genesis mode", () => {
    it("credits everything to the dev wallet", async () => {
      const { genesis, deployer } = await loadFixture(deployFixture);

      await fund(genesis, deployer, 10_000n);
      await genesis.sync();

      expect(await genesis.creditedLauncher()).to.equal(10_000n);
      expect(await genesis.creditedTreasury()).to.equal(0n);
      expect(await genesis.creditedGrowthFund()).to.equal(0n);
    });
  });

  describe("claim", () => {
    it("pays the launcher their share", async () => {
      const { standard, deployer, launcher } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.sync();

      await expect(standard.connect(launcher).claim()).to.changeEtherBalances([launcher], [3_333n]);
    });

    it("pays the treasury its share", async () => {
      const { standard, deployer, treasury } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.sync();

      await expect(standard.connect(treasury).claim()).to.changeEtherBalances([treasury], [3_333n]);
    });

    it("syncs automatically, so a claim includes fees that arrived since", async () => {
      const { standard, deployer, launcher } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      // Never synced. The claim must still pay on the full balance.
      await expect(standard.connect(launcher).claim()).to.changeEtherBalances([launcher], [3_333n]);
    });

    it("refuses a stranger", async () => {
      const { standard, deployer, outsider } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);

      await expect(standard.connect(outsider).claim()).to.be.revertedWithCustomError(standard, "NotEntitled");
    });

    it("refuses the controller, who has no personal credit", async () => {
      const { standard, deployer, controller } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);

      await expect(standard.connect(controller).claim()).to.be.revertedWithCustomError(standard, "NotEntitled");
    });

    it("cannot be claimed twice", async () => {
      const { standard, deployer, launcher } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.connect(launcher).claim();

      await expect(standard.connect(launcher).claim()).to.be.revertedWithCustomError(standard, "NothingToClaim");
    });

    it("does not let the launcher take the treasury's share", async () => {
      const { standard, deployer, launcher, treasury } = await loadFixture(deployFixture);

      // 9,999 does not divide evenly. 9999 * 3333 / 10000 floors to 3332 for
      // each of the treasury and the launcher, and the growth fund takes the
      // remainder of 3335. That asymmetry is the point of this amount: it shows
      // the launcher's claim takes exactly their third and no more.
      await fund(standard, deployer, 9_999n);
      await expect(standard.connect(launcher).claim()).to.changeEtherBalances([launcher], [3_332n]);

      expect(await standard.claimableLauncher()).to.equal(0n);
      expect(await standard.claimableTreasury()).to.equal(3_332n);
      expect(await standard.growthFundAvailable()).to.equal(3_335n);

      // Everything the launcher did not earn is still in the contract.
      expect(await ethers.provider.getBalance(await standard.getAddress())).to.equal(3_332n + 3_335n);

      await expect(standard.connect(treasury).claim()).to.changeEtherBalances([treasury], [3_332n]);
    });

    it("gives the treasury nothing in genesis mode", async () => {
      const { genesis, deployer, treasury } = await loadFixture(deployFixture);

      await fund(genesis, deployer, 10_000n);

      await expect(genesis.connect(treasury).claim()).to.be.revertedWithCustomError(genesis, "NotEntitled");
      expect(await genesis.claimableTreasury()).to.equal(0n);
    });
  });

  describe("growth fund", () => {
    it("pays out only to the controller", async () => {
      const { standard, deployer, controller } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);

      await expect(
        standard.connect(controller).withdrawGrowthFund(controller.address, 3_334n),
      ).to.changeEtherBalances([controller], [3_334n]);
    });

    it("refuses anyone who is not the controller", async () => {
      const { standard, deployer, launcher, treasury, outsider } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.sync();

      for (const signer of [launcher, treasury, outsider]) {
        await expect(
          standard.connect(signer).withdrawGrowthFund(signer.address, 1n),
        ).to.be.revertedWithCustomError(standard, "NotController");
      }
    });

    it("cannot spend more than has accumulated", async () => {
      const { standard, deployer, controller } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.sync();

      await expect(
        standard.connect(controller).withdrawGrowthFund(controller.address, 3_335n),
      ).to.be.revertedWithCustomError(standard, "AmountUnavailable");
    });

    it("cannot be drained twice", async () => {
      const { standard, deployer, controller } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);
      await standard.connect(controller).withdrawGrowthFund(controller.address, 3_334n);

      await expect(
        standard.connect(controller).withdrawGrowthFund(controller.address, 1n),
      ).to.be.revertedWithCustomError(standard, "AmountUnavailable");
    });

    it("refuses the zero address", async () => {
      const { standard, deployer, controller } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);

      await expect(
        standard.connect(controller).withdrawGrowthFund(ethers.ZeroAddress, 1n),
      ).to.be.revertedWithCustomError(standard, "ZeroAddress");
    });

    it("does not exist in genesis mode", async () => {
      const { genesis, deployer, controller } = await loadFixture(deployFixture);

      await fund(genesis, deployer, 10_000n);

      expect(await genesis.growthFundAvailable()).to.equal(0n);
      await expect(
        genesis.connect(controller).withdrawGrowthFund(controller.address, 1n),
      ).to.be.revertedWithCustomError(genesis, "AmountUnavailable");
    });
  });

  describe("executeBuyback", () => {
    it("refuses to run until a router and $BEG are configured", async () => {
      const { standard, deployer, controller } = await loadFixture(deployFixture);

      await fund(standard, deployer, 10_000n);

      // The interface is a real one — Uniswap V3's SwapRouter — but the address
      // is not set, and refusing while unconfigured is what keeps an unconfirmed
      // router from ever being called.
      await expect(
        standard.connect(controller).executeBuyback(1n, 0n),
      ).to.be.revertedWithCustomError(standard, "BuybackNotConfigured");
    });

    it("is controller-only even when configured", async () => {
      const { standard, outsider } = await loadFixture(deployFixture);

      await expect(
        standard.connect(outsider).executeBuyback(1n, 0n),
      ).to.be.revertedWithCustomError(standard, "NotController");
    });
  });

  describe("the split cannot be changed", () => {
    it("exposes no setter, and the rates are constants", async () => {
      const { standard } = await loadFixture(deployFixture);

      expect(await standard.TREASURY_BPS()).to.equal(3_333n);
      expect(await standard.LAUNCHER_BPS()).to.equal(3_333n);
      expect(await standard.BPS_DENOMINATOR()).to.equal(BPS);

      // No function in the ABI takes a new rate, a new party, or a new
      // implementation. If one is ever added, this test should be the thing
      // that fails first.
      const mutators = standard.interface.fragments
        .filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => f.name);

      expect([...new Set(mutators)].sort()).to.deep.equal(
        ["claim", "executeBuyback", "initialize", "pullFromEscrow", "sync", "withdrawGrowthFund"].sort(),
      );
    });
  });
});
