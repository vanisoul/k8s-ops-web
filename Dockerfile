# docker build 範例
# docker build . --build-arg VERSION=1.0.0 -t k8s-ops-web:1.0.0

# docker compose 範例
# docker compose up -d

ARG VERSION=0.0.0

FROM node:22.11.0-slim

ARG VERSION
ARG TARGETARCH
ENV VERSION=${VERSION}

# 安裝目標平台對應架構的 kubectl
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && curl -fsSLo kubectl "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/${TARGETARCH}/kubectl" \
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
