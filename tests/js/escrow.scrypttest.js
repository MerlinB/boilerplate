const { expect } = require('chai');
const {
  bsv,
  buildContractClass,
  PubKey,
  getPreimage,
  Ripemd160,
  Sig,
  signTx,
  toHex,
  Sha256, 
  Bytes,
  SigHashPreimage,
} = require('scryptlib');

const {
  compileContract,
  inputIndex,
  inputSatoshis,
  newTx,
} = require('../../helper');

// A: Alice, B: Bob, E: Escrow
// scenario 1: PA + PB
// scenario 2: PA + PE + Hash 1
// scenario 3: PB + PE + Hash 2

const scenario = 1;

const privateKeyA = new bsv.PrivateKey.fromRandom('testnet');
console.log(`Private key generated: '${privateKeyA.toWIF()}'`);
const publicKeyA = privateKeyA.publicKey;
console.log(toHex(publicKeyA));
const publicKeyHashA = bsv.crypto.Hash.sha256ripemd160(publicKeyA.toBuffer());
//console.log(toHex(publicKeyHashA));

const privateKeyB = new bsv.PrivateKey.fromRandom('testnet');
console.log(`Private key generated: '${privateKeyB.toWIF()}'`);
const publicKeyB = privateKeyB.publicKey;
//console.log(toHex(publicKeyB));
const publicKeyHashB = bsv.crypto.Hash.sha256ripemd160(publicKeyB.toBuffer());
//console.log(toHex(publicKeyHashB));

const privateKeyE = new bsv.PrivateKey.fromRandom('testnet');
console.log(`Private key generated: '${privateKeyE.toWIF()}'`);
const publicKeyE = privateKeyE.publicKey;
//console.log(toHex(publicKeyE));
const publicKeyHashE = bsv.crypto.Hash.sha256ripemd160(publicKeyE.toBuffer());
//console.log(toHex(publicKeyHashE));

const dataBuf1 = Buffer.from("abc");
const hashData1 = bsv.crypto.Hash.sha256(dataBuf1);
//console.log(toHex(hashData1));

const dataBuf2 = Buffer.from("def");
const hashData2 = bsv.crypto.Hash.sha256(dataBuf2);
//console.log(toHex(hashData2));

const fee = 1000;

const tx = newTx();

const amount = inputSatoshis;

describe('Test sCrypt contract Escrow in Javascript', () => {
  let escrow, preimage, result;

  before(() => {
    const Escrow = buildContractClass(compileContract('escrow.scrypt'));
    escrow = new Escrow(new Ripemd160(toHex(publicKeyHashA)), new Ripemd160(toHex(publicKeyHashB)), new Ripemd160(toHex(publicKeyHashE)), new Sha256(toHex(hashData1)), new Sha256(toHex(hashData2)), fee);

    switch(scenario) {
      case 1:
        tx.addOutput(new bsv.Transaction.Output({
          script: bsv.Script.buildPublicKeyHashOut(privateKeyA.toAddress()),
          satoshis: amount / 2 - fee,
        }))

        tx.addOutput(new bsv.Transaction.Output({
          script: bsv.Script.buildPublicKeyHashOut(privateKeyB.toAddress()),
          satoshis: amount / 2 - fee,
        }))

        tx.fee(fee * 2);

        sigA = signTx(tx, privateKeyA, escrow.lockingScript.toASM(), amount);
        sigB = signTx(tx, privateKeyB, escrow.lockingScript.toASM(), amount);

        break;
      case 2:
        tx.addOutput(new bsv.Transaction.Output({
          script: bsv.Script.buildPublicKeyHashOut(privateKeyA.toAddress()),
          satoshis: amount - fee,
        }))

        tx.fee(fee);

        sigA = signTx(tx, privateKeyA, escrow.lockingScript.toASM(), amount);
        sigE = signTx(tx, privateKeyE, escrow.lockingScript.toASM(), amount);
        //console.log(toHex(sigA));
        //console.log(toHex(sigE));

        break;
      case 3:
        tx.addOutput(new bsv.Transaction.Output({
          script: bsv.Script.buildPublicKeyHashOut(privateKeyB.toAddress()),
          satoshis: amount - fee,
        }))

        tx.fee(fee);

        sigB = signTx(tx, privateKeyB, escrow.lockingScript.toASM(), amount);
        sigE = signTx(tx, privateKeyE, escrow.lockingScript.toASM(), amount);

        break;
    }
    
    preimage = getPreimage(
      tx,
      escrow.lockingScript.toASM(),
      inputSatoshis
    );
    //console.log(preimage.toString());

    // set txContext for verification
    escrow.txContext = {
      tx,
      inputIndex,
      inputSatoshis
    };
    //console.log(tx.toString())
  });

  switch(scenario) {
    case 1:
      it('should succeed when pushing right data for scenario 1: PA + PB', () => {
        result = escrow.unlock(
          new SigHashPreimage(toHex(preimage)),
          new PubKey(toHex(publicKeyA)),
          new Sig(toHex(sigA)),
          new PubKey(toHex(publicKeyB)),
          new Sig(toHex(sigB)),
          new Bytes(toHex(''))
        )
        .verify();
        expect(result.success, result.error).to.be.true;
      });

      it('should fail when pushing wrong preimage', () => {
        result = escrow.unlock(
          new SigHashPreimage(toHex(preimage) + '01'),
          new PubKey(toHex(publicKeyA)),
          new Sig(toHex(sigA)),
          new PubKey(toHex(publicKeyB)),
          new Sig(toHex(sigB)),
          new Bytes(toHex(''))
        )
        .verify();
        expect(result.success, result.error).to.be.false;
      });

      break;
    case 2:
      it('should succeed when pushing right data for scenario 2: PA + PE + Hash 1', () => {
        result = escrow.unlock(
          new SigHashPreimage(toHex(preimage)),
          new PubKey(toHex(publicKeyA)),
          new Sig(toHex(sigA)),
          new PubKey(toHex(publicKeyE)),
          new Sig(toHex(sigE)),
          new Bytes(toHex(dataBuf1))
        )
        .verify();
        expect(result.success, result.error).to.be.true;
      });

      it('should fail when pushing wrong preimage', () => {
        result = escrow.unlock(
          new SigHashPreimage(toHex(preimage) + '01'),
          new PubKey(toHex(publicKeyA)),
          new Sig(toHex(sigA)),
          new PubKey(toHex(publicKeyE)),
          new Sig(toHex(sigE)),
          new Bytes(toHex(dataBuf1))
        )
        .verify();
        expect(result.success, result.error).to.be.false;
      });
      break;
    case 3:
      it('should succeed when pushing right data for scenario 3: PB + PE + Hash 2', () => {
        result = escrow.unlock(
          new SigHashPreimage(toHex(preimage)),
          new PubKey(toHex(publicKeyB)),
          new Sig(toHex(sigB)),
          new PubKey(toHex(publicKeyE)),
          new Sig(toHex(sigE)),
          new Bytes(toHex(dataBuf2))
        )
        .verify();
        expect(result.success, result.error).to.be.true;
      });

      it('should fail when pushing wrong preimage', () => {
        result = escrow.unlock(
          new SigHashPreimage(toHex(preimage) + '01'),
          new PubKey(toHex(publicKeyB)),
          new Sig(toHex(sigB)),
          new PubKey(toHex(publicKeyE)),
          new Sig(toHex(sigE)),
          new Bytes(toHex(dataBuf2))
        )
        .verify();
        expect(result.success, result.error).to.be.false;
      });
      break;
  }
});
