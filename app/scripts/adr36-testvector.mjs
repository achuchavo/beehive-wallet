// Generates ADR-036 test vectors with CosmJS so the PHP verifier can be checked
// against a real, independently produced signature.
//   node scripts/adr36-testvector.mjs
import {
  Secp256k1,
  sha256,
  Bip39,
  EnglishMnemonic,
  Slip10,
  Slip10Curve,
  stringToPath,
  ripemd160,
} from '@cosmjs/crypto'
import { toBase64, toBech32, toUtf8 } from '@cosmjs/encoding'

const PREFIX = 'panacea'
const COIN_TYPE = 371

// Fixed test mnemonic (NOT a real wallet - deterministic vector only).
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

async function keypairFromMnemonic(mnemonic) {
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic))
  const { privkey } = Slip10.derivePath(
    Slip10Curve.Secp256k1,
    seed,
    stringToPath(`m/44'/${COIN_TYPE}'/0'/0/0`),
  )
  return Secp256k1.makeKeypair(privkey)
}

function adr36SignDoc(message, signer) {
  // Alphabetical keys, compact separators - must match the PHP builder exactly.
  return JSON.stringify({
    account_number: '0',
    chain_id: '',
    fee: { amount: [], gas: '0' },
    memo: '',
    msgs: [{ type: 'sign/MsgSignData', value: { data: toBase64(toUtf8(message)), signer } }],
    sequence: '0',
  })
}

const kp = await keypairFromMnemonic(MNEMONIC)
const compressed = Secp256k1.compressPubkey(kp.pubkey)
const address = toBech32(PREFIX, ripemd160(sha256(compressed)))

// A message containing '/' and '+' so base64 exercises the JSON-escaping path.
const message = 'Beehive ownership proof\nnonce: a/b+c=\naddress: ' + address

const doc = adr36SignDoc(message, address)
const sig = await Secp256k1.createSignature(sha256(new TextEncoder().encode(doc)), kp.privkey)
const compact = new Uint8Array([...sig.r(32), ...sig.s(32)])

console.log(
  JSON.stringify(
    {
      address,
      prefix: PREFIX,
      message,
      signDoc: doc,
      pubkeyUncompressedB64: toBase64(kp.pubkey),
      signatureB64: toBase64(compact),
    },
    null,
    2,
  ),
)
