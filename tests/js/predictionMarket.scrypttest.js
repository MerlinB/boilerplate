const { expect } = require("chai")
const {
  bsv,
  buildContractClass,
  toHex,
  getPreimage,
  num2bin,
  SigHashPreimage,
  Ripemd160,
  Sig,
  Bytes,
  PubKey,
  signTx
} = require("scryptlib")
const { inputIndex, tx, compileContract, dummyTxId } = require("../../helper")
const { sha256 } = require("pmutils").sha
const { scalingFactor, lmsr, getLmsrShas, getPos } = require("pmutils").lmsr
const { getMerklePath } = require("pmutils").merkleTree

describe("Test sCrypt contract merkleToken In Javascript", () => {
  const Signature = bsv.crypto.Signature
  const sighashType = Signature.SIGHASH_ANYONECANPAY | Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID

  const privateKey = new bsv.PrivateKey.fromRandom("testnet")
  const publicKey = bsv.PublicKey.fromPrivateKey(privateKey)
  const pkh = bsv.crypto.Hash.sha256ripemd160(publicKey.toBuffer())
  const changePKH = toHex(pkh) // Needs to be unprefixed address
  const payoutPKH = changePKH

  const satScaling = 2 ** 20
  const lmsrHashes = getLmsrShas()

  const Token = buildContractClass(compileContract("predictionMarket.scrypt"))

  let token, lockingScriptCodePart, tx_

  beforeEach(() => {
    tx_ = new bsv.Transaction()
    token = new Token()

    lockingScriptCodePart = token.codePart.toASM()
  })

  it("should buy token", () => {
    const liquidity = 0
    const sharesFor = 1
    const sharesAgainst = 0

    const newEntry = toHex(payoutPKH + num2bin(liquidity, 1) + num2bin(sharesFor, 1) + num2bin(sharesAgainst, 1))
    const newLeaf = sha256(newEntry)

    const lastEntry = toHex("00".repeat(20) + "00" + "01" + "00")
    const lastLeaf = sha256(lastEntry)
    const lastMerklePath = sha256(lastEntry) + "01"

    const globalLiquidity = 1
    const globalSharesFor = 1
    const globalSharesAgainst = 1
    const prevSharesStatus = num2bin(globalLiquidity, 1) + num2bin(globalSharesFor, 1) + num2bin(globalSharesAgainst, 1)

    const newLiquidity = globalLiquidity + liquidity
    const newSharesFor = globalSharesFor + sharesFor
    const newSharesAgainst = globalSharesAgainst + sharesAgainst
    const newSharesStatus = num2bin(newLiquidity, 1) + num2bin(newSharesFor, 1) + num2bin(newSharesAgainst, 1)

    const prevBalanceTableRoot = sha256(sha256(lastEntry).repeat(2))
    const newBalanceTableRoot = sha256(sha256(lastEntry) + sha256(newEntry))
    const newLockingScript = lockingScriptCodePart + " OP_RETURN " + newSharesStatus + newBalanceTableRoot

    const inputSatoshis = 6000000 // Ca 10 USD
    const satScalingAdjust = scalingFactor / satScaling
    const prevLmsrBalance = Math.round(lmsr(globalLiquidity, globalSharesFor, globalSharesAgainst) * scalingFactor)
    const newLmsrBalance = Math.round(lmsr(newLiquidity, newSharesFor, newSharesAgainst) * scalingFactor)
    const prevSatBalance = Math.floor(prevLmsrBalance / satScalingAdjust)
    const newSatBalance = Math.floor(newLmsrBalance / satScalingAdjust)
    const cost = newSatBalance - prevSatBalance
    const changeSats = inputSatoshis - cost

    const prevLmsrMerklePath = getMerklePath(getPos(globalLiquidity, globalSharesFor, globalSharesAgainst), lmsrHashes)
    const newLmsrMerklePath = getMerklePath(getPos(newLiquidity, newSharesFor, newSharesAgainst), lmsrHashes)

    token.dataLoad = prevSharesStatus + prevBalanceTableRoot

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: dummyTxId,
        outputIndex: 0,
        script: ""
      }),
      bsv.Script.fromASM(token.lockingScript.toASM()),
      prevSatBalance
    )

    // token output
    tx_.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromASM(newLockingScript),
        satoshis: newSatBalance
      })
    )

    // change output
    tx_.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.buildPublicKeyHashOut(publicKey.toAddress()),
        satoshis: changeSats
      })
    )

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), prevSatBalance, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis: prevSatBalance }

    const result = token
      .addEntry(
        new SigHashPreimage(toHex(preimage)),
        liquidity,
        sharesFor,
        sharesAgainst,
        new Ripemd160(changePKH),
        new Ripemd160(payoutPKH),
        changeSats,
        newLmsrBalance,
        new Bytes(newLmsrMerklePath),
        new Bytes(lastEntry),
        new Bytes(lastMerklePath)
      )
      .verify()

    // console.log(tx_.toString())
    // console.log(toHex(preimage))
    // console.log(token.dataLoad)
    // console.log(prevSatBalance)

    // console.log(liquidity)
    // console.log(sharesFor)
    // console.log(sharesAgainst)
    // console.log(changePKH)
    // console.log(payoutPKH)
    // console.log(changeSats)
    // console.log(newLmsrBalance)
    // console.log(newLmsrMerklePath)
    // console.log(lastEntry)
    // console.log(lastMerklePath)

    expect(result.success, result.error).to.be.true
  })
})
