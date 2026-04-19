FROM node:22-slim

# Python + PyTorch for server training
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Python dependencies
COPY server/requirements.txt server/requirements.txt
RUN python3 -m pip install --break-system-packages -r server/requirements.txt

# App source
COPY . .

EXPOSE 3777

CMD ["node", "server/training_server.js"]
