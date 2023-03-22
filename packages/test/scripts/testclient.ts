import { Cacao, CacaoBlock, SiweMessage } from '@didtools/cacao'
import { Wallet } from '@ethersproject/wallet'
import { randomBytes } from '@stablelib/random'
import { DIDSession, createDIDCacao, createDIDKey } from 'did-session'
import dotenv from 'dotenv'

import { definition } from '../__generated__/composites/index.js'
import { Client } from '../__generated__/index.js'

dotenv.config()

export async function createRandomSession(): Promise<DIDSession> {
  // create the key did
  const keySeed = randomBytes(32)
  const didKey = await createDIDKey(keySeed)
  // create the cacao object
  const wallet = Wallet.createRandom()
  const address = wallet.address
  const siweMessage = new SiweMessage({
    domain: 'intuition.systems',
    address: address,
    statement: 'I authorize my did to be used',
    uri: didKey.id,
    version: '1',
    nonce: '32891757',
    issuedAt: new Date().toISOString(),
    chainId: '1',
    resources: Object.values(definition.models).map((model) => {
      return `ceramic://*?model=${model.id}`
    }),
  })
  const signature = await wallet.signMessage(siweMessage.toMessage())
  siweMessage.signature = signature
  const cacao = Cacao.fromSiweMessage(siweMessage)
  // create the did
  const did = await createDIDCacao(didKey, cacao)
  // create the session
  const session = new DIDSession({ did, cacao, keySeed })
  return session
}

async function main() {
  const session = await createRandomSession()
  const client = new Client({
    ceramicURL: process.env.COMPOSEDB_NODE_URL!,
    did: session.did,
  })
  const resp = await client.subjectPKP.create({
    content: { pkpId: 'asdfasdfasdf', subject: 'asdfasdfasdf' },
  })
  console.log(`created pkp with streamid ${resp.createSubjectPKP?.document.id}`)
  const users = await client.prisma.subjectPKPStream.findMany()
  users.map((u) => console.log(u.stream_content))
}

main().catch((e) => {
  console.error(e)
})
