FROM node:18-alpine

WORKDIR /app

# Install dependencies first for cache layer
COPY package.json ./
RUN npm install

# Copy the rest
COPY . .

EXPOSE 3000

# Start Vite dev server
CMD ["npm", "run", "dev"]
