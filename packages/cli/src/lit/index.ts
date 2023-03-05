import { Cacao, SiweMessage, SiwxMessage } from '@didtools/cacao'
import { LitContracts } from '@lit-protocol/contracts-sdk'
import { pkpHelper } from '@lit-protocol/contracts-sdk/src/abis/PKPHelper.data.js'
import {
  Arrayish,
  PKPHelper,
} from '@lit-protocol/contracts-sdk/src/abis/PKPHelper.js'
import { pkpNft } from '@lit-protocol/contracts-sdk/src/abis/PKPNFT.data.js'
import { PKPNFT } from '@lit-protocol/contracts-sdk/src/abis/PKPNFT.js'
import { pkpPermissions } from '@lit-protocol/contracts-sdk/src/abis/PKPPermissions.data.js'
import { PKPPermissions } from '@lit-protocol/contracts-sdk/src/abis/PKPPermissions.js'
import { LitNodeClient } from '@lit-protocol/lit-node-client'
import { randomBytes } from '@stablelib/random'
import { TransactionReceipt } from 'alchemy-sdk'
import { createDIDCacao, createDIDKey, DIDSession } from 'did-session'
import { BigNumber, Contract, ContractReceipt, errors, Wallet } from 'ethers'
import {
  arrayify,
  hashMessage,
  joinSignature,
  splitSignature,
  verifyMessage,
} from 'ethers/lib/utils.js'
import { Google } from './google.js'

export const CONFIRMATIONS = 1
export const TIMEOUT = 5000

export enum AuthMethodType {
  EthWallet = 1,
  LitAction,
  WebAuthn,
  Discord,
  Google,
  GoogleJwt,
}

export const SIGN_MESSAGE_ACTION_CID =
  'QmQ5yzoCvYcdW6kBqUnFXx6ZNJzQRAsthDvthutwoPggrL'

export const SIGN_RAW_ACTION_CID =
  'Qmf6oYS7nNPV8ZGTk8KdifbPQCa61GwjaMJqXDGac3pnnN'

export const PERMITTED_ACTIONS = [SIGN_MESSAGE_ACTION_CID, SIGN_RAW_ACTION_CID]

export interface LitParams {
  wallet: Wallet
  network?: string
}

export const LitParamsDefault: Partial<LitParams> = {
  network: 'serrano',
}

export class Lit {
  private _wallet: Wallet
  nodeClient: LitNodeClient

  litContracts: LitContracts

  pkpNFTContract!: PKPNFT
  pkpHelperContract!: PKPHelper
  pkpPermissionsContract!: PKPPermissions

  google: Google

  constructor(params: LitParams) {
    params = { ...LitParamsDefault, ...params }
    this._wallet = params.wallet
    this.nodeClient = new LitNodeClient({ litNetwork: params.network })
    this.litContracts = new LitContracts()
    this.#buildContracts(params.wallet)

    this.google = new Google(this, { clientId: process.env.CLIENT_ID! })
  }

  #buildContracts(wallet: Wallet) {
    this.pkpNFTContract = new Contract(
      pkpNft.address,
      pkpNft.abi,
      wallet
    ) as unknown as PKPNFT

    this.pkpHelperContract = new Contract(
      pkpHelper.address,
      pkpHelper.abi,
      wallet
    ) as unknown as PKPHelper

    this.pkpPermissionsContract = new Contract(
      pkpPermissions.address,
      pkpPermissions.abi,
      wallet
    ) as unknown as PKPPermissions
  }

  get wallet(): Wallet {
    return this.wallet
  }

  set wallet(wallet: Wallet) {
    this._wallet = wallet
    this.pkpNFTContract = new Contract(
      pkpNft.address,
      pkpNft.abi,
      this._wallet
    ) as unknown as PKPNFT

    this.pkpHelperContract = new Contract(
      pkpHelper.address,
      pkpHelper.abi,
      this._wallet
    ) as unknown as PKPHelper

    this.pkpPermissionsContract = new Contract(
      pkpPermissions.address,
      pkpPermissions.abi,
      this._wallet
    ) as unknown as PKPPermissions
  }

  async executeLitAction(
    authSig: {
      sig: string
      derivedVia: string
      signedMessage: string
      address: string
    },
    params: { [key: string]: any },
    code?: string,
    ipfsId?: string,
    debug?: boolean
  ) {
    // make sure node client is ready
    if (!this.nodeClient.ready) await this.nodeClient.connect()
    return await this.nodeClient.executeJs({
      authSig,
      jsParams: params,
      code,
      ipfsId,
      debug,
    })
  }

  async signMessage(message: string | Uint8Array, publicKey: string) {
    // make sure node client is ready
    if (!this.nodeClient.ready) await this.nodeClient.connect()
    const label = 'sign_message'
    const authSig = await this._generateAuthSig()
    const resp = await this.nodeClient.executeJs({
      authSig,
      jsParams: {
        message,
        publicKey,
        sigName: label,
      },
      code: `
      (async () => {
        const sigShare = await LitActions.ethPersonalSignMessageEcdsa({ message, publicKey, sigName });
    })();
      `,
    })
    const { r, s, recid } = resp.signatures[label]
    return joinSignature({
      r: '0x' + r,
      s: '0x' + s,
      v: recid,
    })
  }

  async signRaw(
    toSign: string | Uint8Array,
    publicKey: string,
    authSig?: {
      sig: any
      derivedVia: string
      signedMessage: string
      address: string
    }
  ) {
    // make sure node client is ready
    if (!this.nodeClient.ready) await this.nodeClient.connect()
    const label = 'sign_raw'
    const resp = await this.nodeClient.executeJs({
      authSig: authSig || (await this._generateAuthSig()),
      jsParams: {
        toSign,
        publicKey,
        sigName: label,
      },
      code: `
      (async () => {
        const sigShare = await LitActions.signEcdsa({ toSign, publicKey, sigName });
    })();
      `,
    })
    const { r, s, recid } = resp.signatures[label]
    return joinSignature({
      r: '0x' + r,
      s: '0x' + s,
      v: recid,
    })
  }

  async createDIDSession(publicKey: string, siweMessage: Partial<SiwxMessage>) {
    const keySeed = randomBytes(32)
    const didKey = await createDIDKey(keySeed)
    const message = new SiweMessage({
      ...siweMessage,
      uri: didKey.id,
    })
    const sig = await this.signMessage(message.toMessage(), publicKey)
    siweMessage.signature = sig
    const cacao = Cacao.fromSiweMessage(message)
    const did = await createDIDCacao(didKey, cacao)
    const session = new DIDSession({ did, cacao, keySeed })
    return session.serialize()
  }

  async mintPKP(authMethodType: AuthMethodType, idForAuthMethod: string) {
    const mintCost = await this.pkpNFTContract.mintCost()
    return await this.pkpHelperContract.mintNextAndAddAuthMethods(
      2,
      [authMethodType],
      [idForAuthMethod as unknown as Arrayish],
      ['0x' as unknown as Arrayish],
      [[BigNumber.from('0')]],
      true,
      false,
      { value: mintCost }
    )
  }

  async _mintStatus(txHash: string): Promise<{ tokenId?: string }> {
    let receipt: TransactionReceipt
    try {
      receipt = await this.wallet.provider.waitForTransaction(
        txHash,
        CONFIRMATIONS,
        TIMEOUT
      )
    } catch (e: any) {
      // tx not finalized yet
      if (e?.code == errors.TIMEOUT) return {}
      // error with polling
      throw e
    }
    // get tokenId from logs
    const tokenId = receipt.logs[2].topics[3]
    return { tokenId }
  }

  async _pkpMeta(tokenId: string) {
    // ensure all pkp's have action permissions
    await this._pkpAddPermittedActions(tokenId, PERMITTED_ACTIONS)
    return {
      address: await this.pkpPermissionsContract.getEthAddress(tokenId),
      publicKey: await this.pkpPermissionsContract.getPubkey(tokenId),
    }
  }

  async _pkpAddPermittedActions(tokenId: string, cids: string[]) {
    const permittedActions =
      await this.pkpPermissionsContract.getPermittedActions(tokenId)
    let bytes = ''
    for (const cid of cids) {
      bytes = this.litContracts.utils.getBytesFromMultihash(cid)
      if (!permittedActions.includes(bytes)) {
        console.log(`permitting action ${cid}...`)
        let tx = await this.pkpPermissionsContract.addPermittedAction(
          tokenId,
          bytes as any,
          []
        )
        await tx.wait()
      }
    }
  }

  async _generateAuthSig() {
    const domain = 'localhost'
    const origin = 'https://localhost/login'
    const statement =
      'This is a test statement.  You can put anything you want here.'
    const siweMessage = new SiweMessage({
      domain,
      address: this.wallet.address,
      statement,
      uri: origin,
      version: '1',
      chainId: '1',
    })
    const messageToSign = siweMessage.toMessage()
    const signature = await this.wallet.signMessage(messageToSign)
    const recoveredAddress = verifyMessage(messageToSign, signature)
    return {
      sig: signature,
      derivedVia: 'web3.eth.personal.sign',
      signedMessage: messageToSign,
      address: recoveredAddress,
    }
  }
}
