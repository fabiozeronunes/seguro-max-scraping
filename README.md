# Serviço de Scraping - SeguroMax CRM

Este é um serviço separado que usa Playwright (navegador headless) para fazer scraping do Google Maps, Google Negócios e Bing.

## O que faz?

- **Google Maps**: Abre o Maps, busca empresas, extrai nome, telefone, endereço, website
- **Google Negócios**: Busca local no Google, extrai dados dos negócios
- **Bing**: Busca no Bing, extrai dados dos resultados

## Como funciona?

O CRM no Vercel chama este serviço quando o usuário seleciona essas fontes de busca. O serviço abre um navegador invisível, faz a busca, e retorna os dados como JSON.

## Deploy no Render (passo a passo)

### 1. Criar conta no Render
- Acesse https://render.com
- Clique em "Get Started for Free"
- Faça login com GitHub

### 2. Criar novo serviço
- Clique em "New +" → "Web Service"
- Conecte seu repositório GitHub
- Selecione a pasta `scraping-service`

### 3. Configurar
- **Name**: `seguro-max-scraping`
- **Runtime**: Docker
- **Plan**: Free
- **Root Directory**: `scraping-service`

### 4. Variáveis de ambiente
Adicione:
- `SCRAPING_API_KEY`: `seguro-max-scraping-2024`
- `NODE_ENV`: `production`

### 5. Deploy
- Clique em "Create Web Service"
- Aguarde o build (5-10 minutos na primeira vez)
- Pegue a URL (ex: `https://seguro-max-scraping.onrender.com`)

### 6. Testar
Acesse: `https://seguro-max-scraping.onrender.com/health`
Deve retornar: `{"status":"ok"}`

## API Endpoints

### Health Check
```
GET /health
```

### Google Maps Search
```
POST /google-maps
Headers: x-api-key: seu-chave
Body: { "query": "padarias em cabo frio rj", "limit": 10 }
```

### Google Negócios Search
```
POST /google-negocios
Headers: x-api-key: seu-chave
Body: { "query": "padarias em cabo frio rj", "limit": 10 }
```

### Bing Search
```
POST /bing
Headers: x-api-key: seu-chave
Body: { "query": "padarias em cabo frio rj", "limit": 10 }
```

### Combined Search
```
POST /search
Headers: x-api-key: seu-chave
Body: { "query": "padarias em cabo frio rj", "sources": ["google-maps", "bing"], "limit": 10 }
```

## Notas

- O plano free do Render tem 750 horas/mês
- O serviço dorme após 15 minutos de inatividade
- Primeira requisição pode demorar 30-60 segundos (cold start)
- Requisições subsequentes são rápidas
