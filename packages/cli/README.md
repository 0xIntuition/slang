```
   .---. ,-.      .--.  .-. .-.  ,--,              ,--,  ,-.    ,-.
  ( .-._)| |     / /\ \ |  \| |.' .'             .' .')  | |    |(|
 (_) \   | |    / /__\ \|   | ||  |  __ ____.___ |  |(_) | |    (_)
 _  \ \  | |    |  __  || |\  |\  \ ( _)`----==='\  \    | |    | |
( `-'  ) | `--. | |  |)|| | |)| \  `-) )          \  `-. | `--. | |
 `----'  |( __.'|_|  (_)/(  (_) )\____/            \____\|( __.'`-'
         (_)           (__)    (__)                      (_)
```

Web3 Backends Made Easy

## Commands

- `slang composedb:generate` : Generates ComposeDB composites, types, and a full-featured sql client for reads

_more coming soon..._

## Using the Generator

1.  Install Slang globally

    ```sh
    npm install -g @0xintuition/slang-cli
    ```

2.  Fill in a `.env` file with the following content (replace with your info):

    ```sh
    COMPOSEDB_API_URL="http://localhost:7007"
    COMPOSEDB_DB_URL="sqlite:///Users/<your_username>/.ceramic/indexing.sqlite"
    COMPOSEDB_PRIVATE_KEY=<your_composedb_private_key>
    ```

3.  Define a `/schema` folder at the root of your package/repository and add some schemas

    - All files must ordered in the way they are to be deployed (see the [test package](../test/schemas) for example)

    - Dependent model id's can be referenced by using a template string with the model name EG: `id: "${List}"`

4.  Run a local ComposeDB instance

    ```sh
    npx @ceramicnetwork/cli daemon
    ```

    - Make sure that the admin did is set, for more details check out the [composedb docs](https://composedb.js.org/docs/0.4.x/set-up-your-environment#run-a-ceramic-node)

5.  Run `slang composedb:generate` and you're off to the races!

## Using the Client

Check out the code in `__generated__/` after running the generator to see what's available.

#### Reads

Reads can be done by using the Prisma client included in the distributed client like so:

```ts
const client = new Client(...stuff)
const dbStuff = await client.prisma.myModelName.findMany(...moreStuff)
```

Since the `stream_content` column in the database is JSON, the resulting data is untyped. To parse this into a type-safe format, helper functions are included with each service that add a `data` field with the typed object. For example:

```ts
const client = new Client(...stuff)
const dbStuff = await client.prisma.myModelName.findMany(...moreStuff)
/**
 * dbStuff = [
 * {
 *   stream_id: string,
 *   controller_did: string,
 *   stream_content: any,
 *  ...
 * }
 * ...]
 */
const parsedDBStuff = dbStuff.map((s) => client.myModelNameService.parse(s))
/**
 * dbStuff = [
 * {
 *   stream_id: string,
 *   controller_did: string,
 *   stream_content: any,
 *   data: MyModelType
 *  ...
 * }
 * ...]
 */
```

I realize this is not ideal, however it will improve soon as Prisma has been dramatically improving JSON support.

#### Writes

**WRITES MUST BE DONE THROUGH THE COMPOSEDB CLIENT (NOT PRISMA)!!!!!!**

Nice types are included to make this very simple. For example:

```ts
const client = new Client(...stuff)
const resp = await client.myModelNameService.create({
  content: {
    ...myModelFieldsForCreation,
  },
})
```

Zod is used to validate the input fields and ensure they conform to the model schemas you defined.

## Current Issues

- SQLite's dynamic typing causes issues with reading integers that are greater than the 32bit max [issue](https://github.com/prisma/prisma/issues/16144). This will cause problems with ComposeDB, however the Postgres backend works swimmingly!

## Future Plans

- Transpiled client code (currently output in typescript)

- Add Lit command to generate relay code for interacting with PKP's + walletless onboarding

- Add `--encrypt` flag to `composedb:generate` to automatically handle encrypting/decrypting ComposeDB data

- Whatever else you might suggest!

## Special Thanks

- My whole team at [Intuition](https://twitter.com/0xIntuition), stay sweaty <3

- [Ceramic Network](https://composedb.js.org/)

- [Lit Protocol](https://litprotocol.com/)
