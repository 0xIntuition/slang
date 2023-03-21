```
   .---. ,-.      .--.  .-. .-.  ,--,              ,--,  ,-.    ,-.
  ( .-._)| |     / /\ \ |  \| |.' .'             .' .')  | |    |(|
 (_) \   | |    / /__\ \|   | ||  |  __ ____.___ |  |(_) | |    (_)
 _  \ \  | |    |  __  || |\  |\  \ ( _)`----==='\  \    | |    | |
( `-'  ) | `--. | |  |)|| | |)| \  `-) )          \  `-. | `--. | |
 `----'  |( __.'|_|  (_)/(  (_) )\____/            \____\|( __.'`-'
         (_)           (__)    (__)                      (_)
```

CLI for code generation

## What it is

Slang automatically builds the composites, deploys them, and handles generating types + a client for interacting with your composedb models.

## How To Use

1.  Install Slang as a dependency

```sh
npm install @0xintuition/slang-cli@0.0.1
```

2.  Fill in a `.env` file with the following content (replace with your info):

```sh
COMPOSEDB_NODE_URL=<ceramic_node_url>
COMPOSEDB_POSTGRES_URL="postgres://<username>:<password>@<url>:<port>/<db>"
COMPOSEDB_PRIVATE_KEY=<your_composedb_private_key>
```

3. Define a `/models` folder at the root of your package/repository, with all files ordered in the way they are to be deployed (see test package for example)

- Dependent model id's can be referenced by using a template string with the model name EG: `id: "${List}"`

5. Add `"generate: "slang generate",` to the `scripts` section of your `package.json`

6. Run `npm run generate`

7. Check `/__generated__` for all types and generated client

## Future Plans

- Split the code generation and client into separate packages to reduce dependencies needed to use (similar to prisma)

- Add Lit encryption + authentication
