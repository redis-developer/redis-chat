This is a [Redis](https://redis.io/) LLM chatbot for JS and [Node](https://nodejs.org/) using:

- [Redis Cloud](https://redis.io/try-free/)
- [Express](https://expressjs.com/)

## Requirements

- [bun](https://bun.sh/)
- [docker](https://www.docker.com/)
  - Optional

## Getting started

Copy and edit the `.env` file:

```bash
cp .env.example .env
```

Your `.env` file should contain the connection string you copied from Redis Cloud.

Next, spin up docker containers:

```bash
bun docker
```

You should have a server running on `http://localhost:<port>` where the port is set in your `.env` file (default is 8080). Go to that URL in your browser and you should see the chat.

## Running tests

There are some tests in the `__tests__` folder that can be run with the following command:

```bash
bun test --timeout 15000
```

These tests setup and teardown on their own. You can modify them if you want to leave data in Redis.

## Running locally outside docker

To run the development server outside of docker:

```bash
bun install
# then
bun dev
```

## Other Scripts

Formatting code:

```bash
bun format
```

Updating dependencies:

```bash
bun update
```

## Connecting to Redis Cloud

If you don't yet have a database setup in Redis Cloud [get started here for free](https://redis.io/try-free/).

To connect to a Redis Cloud database, log into the console and find the following:

1. The `public endpoint` (looks like `redis-#####.c###.us-east-1-#.ec2.redns.redis-cloud.com:#####`)
1. Your `username` (`default` is the default username, otherwise find the one you setup)
1. Your `password` (either setup through Data Access Control, or available in the `Security` section of the database
   page.

Combine the above values into a connection string and put it in your `.env` and `.env.docker` accordingly. It should
look something like the following:

```bash
REDIS_URL="redis://default:<password>@redis-#####.c###.us-west-2-#.ec2.redns.redis-cloud.com:#####"
```

Run the [tests](#running-tests) to verify that you are connected properly.

## Learn more

To learn more about Redis, take a look at the following resources:

- [Redis Documentation](https://redis.io/docs/latest/) - learn about Redis products, features, and commands.
- [Learn Redis](https://redis.io/learn/) - read tutorials, quick starts, and how-to guides for Redis.
- [Redis Demo Center](https://redis.io/demo-center/) - watch short, technical videos about Redis products and features.
