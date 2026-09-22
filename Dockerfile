# docker build 範例
# docker build . --build-arg VERSION=1.0.0 -t k8s-ops-web:1.0.0

# docker compose 範例
# docker compose up -d

ARG VERSION=0.0.0

FROM node:22.11.0-slim

ARG VERSION
ENV VERSION=${VERSION}

# 安裝 curl, unzip, kubectl
RUN apt-get update && apt-get install -y curl unzip \
    && curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl \
    && rm kubectl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 安裝 bun cli
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install --production --frozen-lockfile || bun install --production

COPY . .

EXPOSE 3000

CMD ["bun", "run", "start"]
