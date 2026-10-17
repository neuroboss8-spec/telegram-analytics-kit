FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
COPY test ./test
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/main.js"]
