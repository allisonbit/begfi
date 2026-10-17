#!/usr/bin/env bash
# Create the BegFi payout key in AWS KMS and import the existing wallet key.
#
# RUN THIS IN AWS CLOUDSHELL, in the account that will hold the key. It uses the
# credentials already attached to the console session, so nothing has to be
# pasted into this repository and no long-lived AWS key is created here.
#
# WHY EXTERNAL ORIGIN. The payout wallet already holds funds and is named on the
# site. A generated key would be a different address. Importing the existing key
# material keeps 0x5400ab13… and takes the private key out of the server process.
#
# SEQUENCE
#   bash aws-kms-setup.sh --phase create
#       -> prints the key ARN and import-params.json
#   (locally) node scripts/kms-import.mjs wrap --params import-params.json
#       -> prints base64 of the wrapped key
#   bash aws-kms-setup.sh --phase import --key-arn <arn> --wrapped-base64 "<b64>"
#       -> imports, then signs the verification digest and prints the signature
#   (locally) node scripts/kms-import.mjs verify --signature "<b64 DER>"
#       -> must print MATCH
#
# AFTERWARDS. Create an IAM user for Vercel with only kms:Sign and kms:GetPublicKey
# on this key ARN, and put its access key in the Vercel project settings, never in
# this repository. The key policy created by default lets IAM decide, so no key
# policy change is needed for that.
set -euo pipefail

PHASE=""
KEY_ARN=""
WRAPPED_B64=""
WRAPPED_FILE=""
TOKEN_B64=""
ALIAS="alias/begfi-distributor"
# keccak256("begfi-kms-verification"); the local script checks this exact digest.
DIGEST_HEX="43ce7de88ce0ea8c599517ae97ff3d695e7f47431aa5bb5f209eadc4270dfd36"

while [ $# -gt 0 ]; do
  case "$1" in
    --phase) PHASE="${2:-}"; shift 2 ;;
    --key-arn) KEY_ARN="${2:-}"; shift 2 ;;
    --wrapped-base64) WRAPPED_B64="${2:-}"; shift 2 ;;
    --wrapped-file) WRAPPED_FILE="${2:-}"; shift 2 ;;
    --import-token-base64) TOKEN_B64="${2:-}"; shift 2 ;;
    --alias) ALIAS="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$PHASE" in
  create)
    echo "Creating an ECC_SECG_P256K1 signing key with imported material..."
    KEY_ARN=$(aws kms create-key \
      --key-spec ECC_SECG_P256K1 \
      --key-usage SIGN_VERIFY \
      --origin EXTERNAL \
      --description "BegFi distributor payout signer" \
      --tags TagKey=project,TagValue=begfi TagKey=purpose,TagValue=distributor-payout \
      --query 'KeyMetadata.Arn' --output text)

    echo "Key ARN: $KEY_ARN"
    aws kms create-alias --alias-name "$ALIAS" --target-key-id "$KEY_ARN"

    aws kms get-parameters-for-import \
      --key-id "$KEY_ARN" \
      --wrapping-algorithm RSAES_OAEP_SHA_256 \
      --wrapping-key-spec RSA_2048 \
      --query '{PublicKey: PublicKey, ImportToken: ImportToken}' \
      --output json > import-params.json

    echo
    echo "import-params.json written. Copy that file to the machine running the repo,"
    echo "or copy the JSON printed below. It contains a public wrapping key and a"
    echo "one-time import token, not the wallet key."
    echo
    cat import-params.json
    echo
    echo "Key state: $(aws kms describe-key --key-id "$KEY_ARN" --query 'KeyMetadata.KeyState' --output text)"
    ;;

  import)
    [ -n "$KEY_ARN" ] || { echo "--key-arn is required" >&2; exit 2; }

    if [ -n "$WRAPPED_FILE" ] && [ -f "$WRAPPED_FILE" ]; then
      cp "$WRAPPED_FILE" wrapped.bin
    elif [ -n "$WRAPPED_B64" ]; then
      printf '%s' "$WRAPPED_B64" | base64 -d > wrapped.bin
    else
      echo "--wrapped-base64 or --wrapped-file is required" >&2; exit 2
    fi

    if [ -n "$TOKEN_B64" ]; then
      printf '%s' "$TOKEN_B64" | base64 -d > import-token.bin
    elif [ ! -f import-token.bin ]; then
      echo "import-token.bin is missing; pass --import-token-base64" >&2; exit 2
    fi

    echo "Importing key material..."
    aws kms import-key-material \
      --key-id "$KEY_ARN" \
      --encrypted-key-material fileb://wrapped.bin \
      --import-token fileb://import-token.bin \
      --expiration-model KEY_MATERIAL_DOES_NOT_EXPIRE

    echo "Key state: $(aws kms describe-key --key-id "$KEY_ARN" --query 'KeyMetadata.KeyState' --output text)"
    echo
    echo "Signing the verification digest ($DIGEST_HEX)..."
    printf '%s' "$DIGEST_HEX" | xxd -r -p > digest.bin
    SIG_B64=$(aws kms sign \
      --key-id "$KEY_ARN" \
      --message fileb://digest.bin \
      --message-type DIGEST \
      --signing-algorithm ECDSA_SHA_256 \
      --query 'Signature' --output text)

    echo
    echo "Signature (base64 DER), paste this into the local verify command:"
    echo "$SIG_B64"
    echo
    echo "Public key (base64 SPKI), useful for a second pair of eyes:"
    aws kms get-public-key --key-id "$KEY_ARN" --query 'PublicKey' --output text
    ;;

  sign)
    [ -n "$KEY_ARN" ] || { echo "--key-arn is required" >&2; exit 2; }
    printf '%s' "${DIGEST_HEX}" | xxd -r -p > digest.bin
    aws kms sign \
      --key-id "$KEY_ARN" \
      --message fileb://digest.bin \
      --message-type DIGEST \
      --signing-algorithm ECDSA_SHA_256 \
      --query 'Signature' --output text
    ;;

  *)
    sed -n '2,30p' "$0"
    exit 2
    ;;
esac
