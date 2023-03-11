```
   .---. ,-.      .--.  .-. .-.  ,--,
  ( .-._)| |     / /\ \ |  \| |.' .'
 (_) \   | |    / /__\ \|   | ||  |  __
 _  \ \  | |    |  __  || |\  |\  \ ( _)
( `-'  ) | `--. | |  |)|| | |)| \  `-) )
 `----'  |( __.'|_|  (_)/(  (_) )\____/
         (_)           (__)    (__)
```

_Off-Chain Data Storage Made Easy_

*Eth Denver Hackathon 2023
Finalist
Bounty Winner: "Best application built using ComposeDB on Ceramic"*

*Disclaimer: This repo is under active development and can change whenever*

## How To Use

1. Fill in a `.env` file with the following content (replace with your info):

```sh
COMPOSEDB_NODE_URL=<ceramic_node_url>
COMPOSEDB_POSTGRES_URL="postgres://<username>:<password>@<url>:<port>/<db>"
COMPOSEDB_PRIVATE_KEY=<your_composedb_private_key>
```

2. Define a `/models` folder at the root of your package/repository, with all files ordered in the way they are to be deployed.

-  Dependent model id's can be referenced by using a template string with the model name EG: `id: "${List}"`

3. Run `npm install <path-to-this-repository>`

4. Run `slang generate`

5. Check `/__generated__` for all types and generated client

## What it is

Slang automatically builds the composites, deploys them, and handles generating types + a client for interacting with your composedb models.
