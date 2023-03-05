import { keccak256, toUtf8Bytes } from 'ethers/lib/utils.js'
import { OAuth2Client, TokenPayload } from 'google-auth-library'
import { AuthMethodType, Lit } from './index.js'

export interface GoogleParams {
  clientId: string
}

export class Google {
  lit: Lit
  oauth2Client: OAuth2Client

  constructor(lit: Lit, params: GoogleParams) {
    this.lit = lit
    this.oauth2Client = new OAuth2Client({ clientId: params.clientId })
  }

  async verify(credentials: string): Promise<TokenPayload> {
    console.log('verifying google credentials...')
    const ticket = await this.oauth2Client.verifyIdToken({
      idToken: credentials,
    })
    return await ticket.getPayload()!
  }

  async mintPKP(sub: string, aud: string) {
    console.log(`minting pkp via google auth...`)
    const idForAuthMethod = keccak256(toUtf8Bytes(`${sub}:${aud}`))
    return await this.lit.mintPKP(AuthMethodType.GoogleJwt, idForAuthMethod)
  }
}
