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
 */

const Mode = { Standard: 0, Genesis: 1 };

const BPS = 10_000n;

async function deployFixture() {
  const [deployer, treasury, launcher, controller, outsider] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("BegSplitterFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  async function create(mode) {
    const tx = await factory.createSplitter(
      mode,
      treasury.address,
      launcher.address,
      controller.address,
      ethers.ZeroAddress, // begToken — unset, so buybacks are unconfigured
      ethers.ZeroAddress, // buybackRouter
      ethers.ZeroAddress, // weth
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

  const standard = await create(Mode.Standard);
  const genesis = await create(Mode.Genesis);

  return { factory, standard, genesis, deployer, treasury, launcher, controller, outsider };
}

const fund = async (splitter, from, amount) => {
  await from.sendTransaction({ to: await splitter.getAddress(), value: amount });
};

describe("BegSplitter", () => {
  describe("initialisation", () => {
    it("records the parties and the mode", async () => {
      const { standard, treasury, launcher, controller } = await loadFixture(deployFixture);

      expect(await standard.mode()).to.equal(Mode.Standard);
      expect(await standard.treasury()).to.equal(treasury.address);
      expect(await standard.launcher()).to.equal(launcher.address);
      expect(await standard.controller()).to.equal(controller.address);
    });

    it("refuses a zero treasury, launcher or controller", async () => {
      const { factory, treasury, launcher, controller } = await loadFixture(deployFixture);

      // The error is declared on BegSplitter, not on the factory that triggers
      // it, so the matcher has to be given the splitter's ABI to decode it.
      const impl = await ethers.getContractAt("BegSplitter", await factory.implementation());

      await expect(
        factory.createSplitter(Mode.Standard, ethers.ZeroAddress, launcher.address, controller.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(impl, "ZeroAddress");

      await expect(
        factory.createSplitter(Mode.Standard, treasury.address, ethers.ZeroAddress, controller.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(impl, "ZeroAddress");

      await expect(
        factory.createSplitter(Mode.Standard, treasury.address, launcher.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(impl, "ZeroAddress");
    });

    it("cannot be initialised a second time", async () => {
      const { standard, treasury, launcher, controller } = await loadFixture(deployFixture);

      await expect(
        standard.initialize(Mode.Genesis, treasury.address, launcher.address, controller.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(standard, "InvalidInitialization");
    });

    it("leaves the implementation contract itself unusable", async () => {
      const { factory, treasury, launcher, controller } = await loadFixture(deployFixture);
      const impl = await ethers.getContractAt("BegSplitter", await factory.implementation());

      // The implementation's constructor sealed it, so nobody can initialise it
      // and take over the address every clone delegates to.
      await expect(
        impl.initialize(Mode.Standard, treasury.address, launcher.address, controller.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress),
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

      await expect(standard.connect(launcher).claim()).to.changeEtherBalances(
        [launcher],
        [3_333n],
      );
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

      // The interface in the contract is a guess at the chain's DEX. Refusing
      // while unconfigured is what keeps that guess from ever executing.
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

      expect(mutators.sort()).to.deep.equal(
        ["claim", "executeBuyback", "initialize", "sync", "withdrawGrowthFund"].sort(),
      );
    });
  });
});
