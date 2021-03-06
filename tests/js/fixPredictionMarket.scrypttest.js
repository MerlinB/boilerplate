const { expect } = require("chai")
const {
  bsv,
  buildContractClass,
  toHex,
  getPreimage,
  SigHashPreimage,
  OpCodeType,
  Ripemd160,
  Sig,
  Bytes,
  PubKey,
  signTx
} = require("scryptlib")
const { inputIndex, tx, compileContract, dummyTxId } = require("../../helper")
const { sha256 } = require("bitcoin-predict").sha
const { ScalingFactor, lmsr, getLmsrShas, getPos } = require("bitcoin-predict").lmsr
const { getMerklePath } = require("bitcoin-predict").merkleTree
const { int2Hex } = require("bitcoin-predict").hex
const { generatePrivKey, privKeyToPubKey, sign } = require("rabinsig")
const { decimalToHexString } = require("rabinsig/src/utils")

const rabinKeyLength = 126

const Token = buildContractClass(compileContract("predictionMarket.scrypt"))
// const Token = buildContractClass(require("../../out/predictionMarket_desc.json"))

describe("Test sCrypt contract merkleToken In Javascript", () => {
  const Signature = bsv.crypto.Signature
  const sighashType = Signature.SIGHASH_ANYONECANPAY | Signature.SIGHASH_SINGLE | Signature.SIGHASH_FORKID

  const privateKey = bsv.PrivateKey.fromString("Kys3cyL5HZ4upzwWsnirv4urUeczpnweiJ2zY5EDBCkRZ5j2TTdj")
  const publicKey = bsv.PublicKey.fromPrivateKey(privateKey)
  const pubKeyHex = toHex(publicKey)
  const pkh = bsv.crypto.Hash.sha256ripemd160(publicKey.toBuffer())
  const changePKH = toHex(pkh) // Needs to be unprefixed address
  const payoutPKH = changePKH

  const satScaling = 2 ** 20
  const lmsrHashes = getLmsrShas()

  const priv1 = {
    p: 3097117482495218740761570398276008894011381249145414887346233174147008460690669803628686127894575795412733149071918669075694907431747167762627687052467n,
    q: 650047001204168007801848889418948532353073326909497585177081016045346562912146630794965372241635285465610094863279373295872825824127728241709483771067n
  }

  const priv2 = {
    p: 5282996768621071377953148561714230757875959595062017918330039194973991105026912034418577469175391947647260152227014115175065212479767996019477136300223n,
    q: 650047001204168007801848889418948532353073326909497585177081016045346562912146630794965372241635285465610094863279373295872825824127728241709483771067n
  }

  const pub1 = privKeyToPubKey(priv1.p, priv1.q)
  const pub2 = privKeyToPubKey(priv2.p, priv2.q)
  const pub1Hex = int2Hex(pub1, rabinKeyLength)
  const pub2Hex = int2Hex(pub2, rabinKeyLength)
  const miner1Votes = 40
  const miner2Votes = 60
  const minerPubs = [pub1Hex, int2Hex(miner1Votes, 1), pub2Hex, int2Hex(miner2Votes, 1)].join("")

  const marketString =
    "25c78e732e3af9aa593d1f71912775bcb2ada1bf 007b0022007200650073006f006c007600650022003a002200740065007300740022007d "

  let token, lockingScriptCodePart, tx_

  function testAddEntry(liquidity, sharesFor, sharesAgainst, globalLiquidity, globalSharesFor, globalSharesAgainst) {
    const newEntry = toHex(pubKeyHex + int2Hex(liquidity, 1) + int2Hex(sharesFor, 1) + int2Hex(sharesAgainst, 1))
    const newLeaf = sha256(newEntry)

    const lastEntry = toHex(
      pubKeyHex + int2Hex(globalLiquidity, 1) + int2Hex(globalSharesFor, 1) + int2Hex(globalSharesAgainst, 1)
    )
    const lastLeaf = sha256(lastEntry)
    const lastMerklePath = lastLeaf + "01"

    const prevSharesStatus = int2Hex(globalLiquidity, 1) + int2Hex(globalSharesFor, 1) + int2Hex(globalSharesAgainst, 1)

    const newLiquidity = globalLiquidity + liquidity
    const newSharesFor = globalSharesFor + sharesFor
    const newSharesAgainst = globalSharesAgainst + sharesAgainst
    const newSharesStatus = int2Hex(newLiquidity, 1) + int2Hex(newSharesFor, 1) + int2Hex(newSharesAgainst, 1)

    const prevBalanceTableRoot = sha256(sha256(lastEntry).repeat(2))
    const newBalanceTableRoot = sha256(sha256(lastEntry) + sha256(newEntry))
    const newStatus = marketString + "00" + "00" + newSharesStatus + newBalanceTableRoot
    const prevStatus = marketString + "00" + "00" + prevSharesStatus + prevBalanceTableRoot
    const newLockingScript = [lockingScriptCodePart, newStatus].join(" ")

    const inputSatoshis = 6000000 // Ca 10 USD
    const satScalingAdjust = ScalingFactor / satScaling
    const prevLmsrBalance = Math.round(
      lmsr({ liquidity: globalLiquidity, sharesFor: globalSharesFor, sharesAgainst: globalSharesAgainst }) *
        ScalingFactor
    )
    const newLmsrBalance = Math.round(
      lmsr({ liquidity: newLiquidity, sharesFor: newSharesFor, sharesAgainst: newSharesAgainst }) * ScalingFactor
    )
    const prevSatBalance = Math.floor(prevLmsrBalance / satScalingAdjust)
    const newSatBalance = Math.floor(newLmsrBalance / satScalingAdjust)
    const cost = newSatBalance - prevSatBalance
    const changeSats = inputSatoshis - cost
    // console.log("in: ", prevSatBalance)
    // console.log("out: ", newSatBalance)
    // console.log("change: ", changeSats)

    const prevLmsrMerklePath = getMerklePath(
      getPos({ liquidity: globalLiquidity, sharesFor: globalSharesFor, sharesAgainst: globalSharesAgainst }),
      lmsrHashes
    )
    const newLmsrMerklePath = getMerklePath(
      getPos({ liquidity: newLiquidity, sharesFor: newSharesFor, sharesAgainst: newSharesAgainst }),
      lmsrHashes
    )

    // console.log(lastEntry)
    // console.log(prevBalanceTableRoot)
    // console.log(newBalanceTableRoot)

    token.setDataPart(prevStatus)

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: "ff5322f5c3fbb22804faf456382f3cf81b8fa202f05258f491a3ee0ed85dd1e1",
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

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), prevSatBalance, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis: prevSatBalance }

    // console.log(toHex(preimage))

    const result = token
      .addEntry(
        new SigHashPreimage(toHex(preimage)),
        liquidity,
        sharesFor,
        sharesAgainst,
        new PubKey(pubKeyHex),
        newLmsrBalance,
        new Bytes(newLmsrMerklePath),
        new Bytes(lastEntry),
        new Bytes(lastMerklePath)
      )
      .verify()

    // console.log(tx_.toString())
    // console.log(toHex(preimage))
    // console.log(prevSharesStatus + prevBalanceTableRoot)
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

    return result
  }

  function testUpdateEntry(
    liquidity,
    sharesFor,
    sharesAgainst,
    prevLiquidity,
    prevSharesFor,
    prevSharesAgainst,
    globalLiquidity,
    globalSharesFor,
    globalSharesAgainst
  ) {
    const newEntry = toHex(pubKeyHex + int2Hex(liquidity, 1) + int2Hex(sharesFor, 1) + int2Hex(sharesAgainst, 1))
    const newLeaf = sha256(newEntry)

    const prevEntry = toHex(
      pubKeyHex + int2Hex(prevLiquidity, 1) + int2Hex(prevSharesFor, 1) + int2Hex(prevSharesAgainst, 1)
    )
    const prevLeaf = sha256(prevEntry)
    const merklePath = prevLeaf + "01"

    const prevSharesStatus = int2Hex(globalLiquidity, 1) + int2Hex(globalSharesFor, 1) + int2Hex(globalSharesAgainst, 1)

    const liquidityChange = liquidity - prevLiquidity
    const sharesForChange = sharesFor - prevSharesFor
    const sharesAgainstChange = sharesAgainst - prevSharesAgainst

    const newGlobalLiquidity = globalLiquidity + liquidityChange
    const newGlobalSharesFor = globalSharesFor + sharesForChange
    const newGlobalSharesAgainst = globalSharesAgainst + sharesAgainstChange
    const newSharesStatus =
      int2Hex(newGlobalLiquidity, 1) + int2Hex(newGlobalSharesFor, 1) + int2Hex(newGlobalSharesAgainst, 1)

    const prevBalanceTableRoot = sha256(sha256(prevEntry).repeat(2))
    const newBalanceTableRoot = sha256(sha256(newEntry).repeat(2))
    const newStatus = marketString + "00" + "00" + newSharesStatus + newBalanceTableRoot
    const prevStatus = marketString + "00" + "00" + prevSharesStatus + prevBalanceTableRoot
    const newLockingScript = [lockingScriptCodePart, newStatus].join(" ")

    const inputSatoshis = 6000000 // Ca 10 USD
    const satScalingAdjust = ScalingFactor / satScaling
    const prevLmsrBalance = Math.round(
      lmsr({ liquidity: globalLiquidity, sharesFor: globalSharesFor, sharesAgainst: globalSharesAgainst }) *
        ScalingFactor
    )
    const newLmsrBalance = Math.round(
      lmsr({ liquidity: newGlobalLiquidity, sharesFor: newGlobalSharesFor, sharesAgainst: newGlobalSharesAgainst }) *
        ScalingFactor
    )
    const prevSatBalance = Math.floor(prevLmsrBalance / satScalingAdjust)
    const newSatBalance = Math.floor(newLmsrBalance / satScalingAdjust)
    const cost = newSatBalance - prevSatBalance
    const changeSats = inputSatoshis - cost
    // console.log("in: ", prevSatBalance)
    // console.log("out: ", newSatBalance)
    // console.log("change: ", changeSats)

    // return true

    const prevLmsrMerklePath = getMerklePath(
      getPos({ liqudity: globalLiquidity, sharesFor: globalSharesFor, sharesAgainst: globalSharesAgainst }),
      lmsrHashes
    )
    const newLmsrMerklePath = getMerklePath(
      getPos({ liquidity: newGlobalLiquidity, sharesFor: newGlobalSharesFor, sharesAgainst: newGlobalSharesAgainst }),
      lmsrHashes
    )

    token.setDataPart(prevStatus)

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: "ff5322f5c3fbb22804faf456382f3cf81b8fa202f05258f491a3ee0ed85dd1e1",
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

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), prevSatBalance, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis: prevSatBalance }

    sig = signTx(tx_, privateKey, token.lockingScript.toASM(), prevSatBalance, inputIndex, sighashType)

    const result = token
      .updateEntry(
        new SigHashPreimage(toHex(preimage)),
        liquidity,
        sharesFor,
        sharesAgainst,
        prevLiquidity,
        prevSharesFor,
        prevSharesAgainst,
        new PubKey(pubKeyHex),
        new Sig(toHex(sig)),
        newLmsrBalance,
        new Bytes(newLmsrMerklePath),
        new Bytes(merklePath)
      )
      .verify()

    // console.log(tx_.toString())
    // console.log(toHex(preimage))
    // console.log(prevSharesStatus + prevBalanceTableRoot)
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

    return result
  }

  beforeEach(() => {
    tx_ = new bsv.Transaction()
    token = new Token(new Bytes(minerPubs))

    lockingScriptCodePart = token.codePart.toASM()
  })

  it("should buy token", () => {
    result = testAddEntry(0, 1, 0, 1, 0, 0)
    expect(result.success, result.error).to.be.true
  })

  it("should buy multiple tokens", () => {
    result = testAddEntry(0, 2, 0, 1, 1, 1)
    expect(result.success, result.error).to.be.true
  })

  it("should add liquidity", () => {
    result = testAddEntry(1, 0, 0, 1, 2, 1)
    expect(result.success, result.error).to.be.true
  })

  it("should buy more tokens", () => {
    result = testUpdateEntry(1, 1, 0, 1, 0, 0, 1, 0, 0)
    expect(result.success, result.error).to.be.true
  })

  it("should sell tokens", () => {
    result = testUpdateEntry(0, 0, 0, 0, 1, 0, 1, 1, 1)
    expect(result.success, result.error).to.be.true
  })

  it("should sell more tokens", () => {
    result = testUpdateEntry(0, 1, 0, 1, 2, 1, 3, 2, 3)
    expect(result.success, result.error).to.be.true
  })

  it("should sell all tokens", () => {
    result = testUpdateEntry(0, 0, 0, 0, 2, 0, 1, 2, 5)
    expect(result.success, result.error).to.be.true
  })

  it("should verify signatures", () => {
    const inputSatoshis = 6000000
    const vote = 1
    const sig1 = sign(int2Hex(vote, 1), priv1.p, priv1.q, pub1)
    const sig2 = sign(int2Hex(vote, 1), priv2.p, priv2.q, pub2)
    const sig1Hex = int2Hex(sig1.signature, rabinKeyLength)
    const sig2Hex = int2Hex(sig2.signature, rabinKeyLength)

    const minerSigs = [
      int2Hex(0, 1),
      sig1Hex,
      int2Hex(sig1.paddingByteCount, 1),
      int2Hex(1, 1),
      sig2Hex,
      int2Hex(sig2.paddingByteCount, 1)
    ].join("")

    const newOpReturn = "01" + "01" + "00".repeat(35)
    const newLockingScript = [lockingScriptCodePart, newOpReturn].join(" ")

    token.setDataPart("00".repeat(37))

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: dummyTxId,
        outputIndex: 0,
        script: ""
      }),
      bsv.Script.fromASM(token.lockingScript.toASM()),
      inputSatoshis
    )

    // token output
    tx_.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromASM(newLockingScript),
        satoshis: inputSatoshis
      })
    )

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), inputSatoshis, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis }

    // console.log(minerPubs)
    // console.log(toHex(preimage))
    // console.log(vote)
    // console.log(minerSigs)
    // console.log(tx_.toString())
    // console.log("00".repeat(37))

    const result = token.decide(new SigHashPreimage(toHex(preimage)), vote, new Bytes(minerSigs)).verify()
    expect(result.success, result.error).to.be.true
  })

  it("should verify partial signatures", () => {
    const inputSatoshis = 6000000
    const vote = 1
    const sig1 = sign(int2Hex(vote, 1), priv1.p, priv1.q, pub1)
    const sig2 = sign(int2Hex(vote, 1), priv2.p, priv2.q, pub2)
    const sig1Hex = int2Hex(sig1.signature, rabinKeyLength)
    const sig2Hex = int2Hex(sig2.signature, rabinKeyLength)

    const minerSigs = [int2Hex(1, 1), sig2Hex, int2Hex(sig2.paddingByteCount, 1)].join("")

    const newOpReturn = "01" + "01" + "00".repeat(35)
    const newLockingScript = [lockingScriptCodePart, newOpReturn].join(" ")

    token.setDataPart("00".repeat(37))

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: dummyTxId,
        outputIndex: 0,
        script: ""
      }),
      bsv.Script.fromASM(token.lockingScript.toASM()),
      inputSatoshis
    )

    // token output
    tx_.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromASM(newLockingScript),
        satoshis: inputSatoshis
      })
    )

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), inputSatoshis, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis }

    // console.log(minerPubs)
    // console.log(toHex(preimage))
    // console.log(vote)
    // console.log(minerSigs)
    // console.log(tx_.toString())
    // console.log("00".repeat(37))

    const result = token.decide(new SigHashPreimage(toHex(preimage)), vote, new Bytes(minerSigs)).verify()
    expect(result.success, result.error).to.be.true
  })

  it("should not verify insufficient signatures", () => {
    const inputSatoshis = 6000000
    const vote = 1
    const sig1 = sign(int2Hex(vote, 1), priv1.p, priv1.q, pub1)
    const sig2 = sign(int2Hex(vote, 1), priv2.p, priv2.q, pub2)
    const sig1Hex = int2Hex(sig1.signature, rabinKeyLength)
    const sig2Hex = int2Hex(sig2.signature, rabinKeyLength)

    const minerSigs = [int2Hex(0, 1), sig1Hex, int2Hex(sig1.paddingByteCount, 1)].join("")

    const newOpReturn = "01" + "01" + "00".repeat(35)
    const newLockingScript = [lockingScriptCodePart, newOpReturn].join(" ")

    token.setDataPart("00".repeat(37))

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: dummyTxId,
        outputIndex: 0,
        script: ""
      }),
      bsv.Script.fromASM(token.lockingScript.toASM()),
      inputSatoshis
    )

    // token output
    tx_.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromASM(newLockingScript),
        satoshis: inputSatoshis
      })
    )

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), inputSatoshis, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis }

    // console.log(minerPubs)
    // console.log(toHex(preimage))
    // console.log(vote)
    // console.log(minerSigs)
    // console.log(tx_.toString())
    // console.log("00".repeat(37))

    const result = token.decide(new SigHashPreimage(toHex(preimage)), vote, new Bytes(minerSigs)).verify()
    expect(result.success, result.error).to.be.false
  })

  it("should not verify signatures twice", () => {
    const inputSatoshis = 6000000
    const vote = 1
    const sig1 = sign(int2Hex(vote, 1), priv1.p, priv1.q, pub1)
    const sig2 = sign(int2Hex(vote, 1), priv2.p, priv2.q, pub2)
    const sig1Hex = int2Hex(sig1.signature, rabinKeyLength)
    const sig2Hex = int2Hex(sig2.signature, rabinKeyLength)

    const minerSigs = [
      int2Hex(0, 1),
      sig1Hex,
      int2Hex(sig1.paddingByteCount, 1),
      int2Hex(1, 1),
      sig2Hex,
      int2Hex(sig2.paddingByteCount, 1)
    ].join("")

    const newOpReturn = "01" + "01" + "00".repeat(35)
    const newLockingScript = [lockingScriptCodePart, newOpReturn].join(" ")

    token.setDataPart("01" + "00".repeat(36))

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: dummyTxId,
        outputIndex: 0,
        script: ""
      }),
      bsv.Script.fromASM(token.lockingScript.toASM()),
      inputSatoshis
    )

    // token output
    tx_.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromASM(newLockingScript),
        satoshis: inputSatoshis
      })
    )

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), inputSatoshis, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis }

    // console.log(minerPubs)
    // console.log(toHex(preimage))
    // console.log(vote)
    // console.log(minerSigs)
    // console.log(tx_.toString())
    // console.log("00".repeat(37))

    const result = token.decide(new SigHashPreimage(toHex(preimage)), vote, new Bytes(minerSigs)).verify()
    expect(result.success, result.error).to.be.false
  })

  it("should redeem tokens", () => {
    const prevLiquidity = 1
    const prevSharesFor = 1
    const prevSharesAgainst = 0

    const globalLiquidity = 1
    const globalSharesFor = 1
    const globalSharesAgainst = 0

    const prevEntry = toHex(
      pubKeyHex + int2Hex(prevLiquidity, 1) + int2Hex(prevSharesFor, 1) + int2Hex(prevSharesAgainst, 1)
    )
    const newEntry = toHex(int2Hex(prevLiquidity, 1), int2Hex(0, 1), int2Hex(0, 1))

    const prevLeaf = sha256(prevEntry)
    const merklePath = prevLeaf + "01"

    const sharesStatus = int2Hex(globalLiquidity, 1) + int2Hex(globalSharesFor, 1) + int2Hex(globalSharesAgainst, 1)

    const prevBalanceTableRoot = sha256(sha256(prevEntry).repeat(2))
    const newBalanceTableRoot = sha256(sha256(newEntry).repeat(2))
    const newStatus = "01" + "01" + sharesStatus + newBalanceTableRoot
    const prevStatus = "01" + "01" + sharesStatus + prevBalanceTableRoot
    const newLockingScript = [lockingScriptCodePart, newStatus].join(" ")

    const inputSatoshis = 6000000 // Ca 10 USD
    const newSatBalance = inputSatoshis - prevSharesFor * satScaling

    token.setDataPart(prevStatus)

    tx_.addInput(
      new bsv.Transaction.Input({
        prevTxId: dummyTxId,
        outputIndex: 0,
        script: ""
      }),
      bsv.Script.fromASM(token.lockingScript.toASM()),
      inputSatoshis
    )

    // token output
    tx_.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromASM(newLockingScript),
        satoshis: newSatBalance
      })
    )

    const preimage = getPreimage(tx_, token.lockingScript.toASM(), inputSatoshis, inputIndex, sighashType)

    token.txContext = { tx: tx_, inputIndex, inputSatoshis }

    sig = signTx(tx_, privateKey, token.lockingScript.toASM(), inputSatoshis, inputIndex, sighashType)

    const result = token
      .redeem(
        new SigHashPreimage(toHex(preimage)),
        prevLiquidity,
        prevSharesFor,
        prevSharesAgainst,
        new PubKey(pubKeyHex),
        new Sig(toHex(sig)),
        new Bytes(merklePath)
      )
      .verify()

    // console.log(tx_.toString())
    // console.log(toHex(preimage))
    // console.log(prevSharesStatus + prevBalanceTableRoot)
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

    return result
  })
})
