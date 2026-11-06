FROM node:22-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV VITE_API_BASE_URL=/
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY --from=frontend /app/dist dist
EXPOSE 5001
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--timeout", "90", "backend.app:app"]
