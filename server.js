const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SCRAPING_API_KEY || 'seguro-max-scraping-2024';

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Auth middleware
function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Google Maps scraping
app.post('/google-maps', auth, async (req, res) => {
  const { query, limit = 10 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  let browser;
  try {
    console.log(`[Google Maps] Searching: "${query}" (limit: ${limit})`);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setDefaultTimeout(30000);
    
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    
    await page.waitForTimeout(5000);
    
    // Scroll the results panel to load more
    const scrollable = await page.$('[role="feed"]');
    if (scrollable) {
      for (let i = 0; i < 3; i++) {
        await scrollable.evaluate(el => el.scrollTop += 500);
        await page.waitForTimeout(1000);
      }
    }
    
    // Extract business data from the page
    const businesses = await page.evaluate((maxResults) => {
      const results = [];
      const seen = new Set();
      
      // Method 1: Extract from result cards
      const cards = document.querySelectorAll('[class*="Nv2PK"], [role="article"], .bfdHYd');
      
      for (const card of cards) {
        if (results.length >= maxResults) break;
        
        const nameEl = card.querySelector('[class*="qBF1Pd"], .fontHeadlineSmall, .NrDZNb, .qBF1Pd');
        const name = nameEl?.textContent?.trim() || '';
        
        if (!name || seen.has(name)) continue;
        seen.add(name);
        
        // Get rating
        const ratingEl = card.querySelector('[class*="MW4etd"], .MW4etd');
        const rating = ratingEl?.textContent?.trim() || '';
        
        // Get reviews count
        const reviewsEl = card.querySelector('[class*="UY7F9"], .UY7F9');
        const reviews = reviewsEl?.textContent?.replace(/[()]/g, '').trim() || '';
        
        // Get category/type
        const categoryEl = card.querySelector('[class*="W4Efsd"]:last-child, .W4Efsd span:last-child');
        const category = categoryEl?.textContent?.trim() || '';
        
        // Get address
        const addressEl = card.querySelector('[class*="W4Efsd"] span[class*="fontBodyMedium"]');
        const address = addressEl?.textContent?.trim() || '';
        
        // Try to get phone from aria-label
        const phoneLabel = card.getAttribute('aria-label') || '';
        const phoneMatch = phoneLabel.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);
        const phone = phoneMatch ? phoneMatch[1] : '';
        
        results.push({ name, rating, reviews, category, address, phone });
      }
      
      // Method 2: If no cards found, try aria-label approach
      if (results.length === 0) {
        const items = document.querySelectorAll('[aria-label]');
        for (const item of items) {
          if (results.length >= maxResults) break;
          const label = item.getAttribute('aria-label');
          if (label && label.length > 5 && !label.includes('Google') && !label.includes('Maps') && !label.includes('Menu') && !label.includes('Voltar')) {
            if (!seen.has(label)) {
              seen.add(label);
              results.push({ name: label, rating: '', reviews: '', category: '', address: '', phone: '' });
            }
          }
        }
      }
      
      return results;
    }, limit);
    
    const results = businesses.map(b => ({
      fonte: 'Google Maps',
      nome: b.name,
      email: '',
      telefone: b.phone || '',
      whatsapp: (b.phone || '').replace(/\D/g, ''),
      empresa: b.name,
      endereco: b.address,
      cidade: '',
      estado: '',
      website: '',
      descricao: `${b.category} ${b.rating ? '- Nota: ' + b.rating : ''} ${b.reviews ? '(' + b.reviews + ')' : ''}`.trim(),
      url_origem: `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
    }));
    
    res.json({ results, total: results.length });
    
  } catch (error) {
    console.error('[Google Maps] Error:', error.message);
    res.json({ results: [], total: 0, error: error.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// Google Negócios - fast Google Maps search without click-to-detail
app.post('/google-negocios', auth, async (req, res) => {
  const { query, limit = 10 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  let browser;
  try {
    console.log(`[Google Negocios] Searching: "${query}" (limit: ${limit})`);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setDefaultTimeout(30000);

    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(5000);

    // Scroll to load more results
    const scrollable = await page.$('[role="feed"]');
    if (scrollable) {
      for (let i = 0; i < 5; i++) {
        await scrollable.evaluate(el => el.scrollTop += 500);
        await page.waitForTimeout(800);
      }
    }

    // Extract everything from list view - enhanced extraction
    const businesses = await page.evaluate((maxResults) => {
      const results = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="Nv2PK"], [role="article"], .bfdHYd');

      for (const card of cards) {
        if (results.length >= maxResults) break;

        const nameEl = card.querySelector('[class*="qBF1Pd"], .fontHeadlineSmall, .NrDZNb');
        const name = nameEl?.textContent?.trim() || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const ratingEl = card.querySelector('[class*="MW4etd"], .MW4etd');
        const rating = ratingEl?.textContent?.trim() || '';

        const reviewsEl = card.querySelector('[class*="UY7F9"], .UY7F9');
        const reviews = reviewsEl?.textContent?.replace(/[()]/g, '').trim() || '';

        // Get all text from card for phone extraction
        const fullText = card.innerText || '';
        const phoneMatch = fullText.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);

        // Get category from aria-label or card text
        const categoryParts = fullText.split('\n').filter(l => l.length > 2 && l.length < 50);
        const category = categoryParts.find(l => /loja|restaurante|mecânica|oficina|auto|serviço|comércio/i.test(l)) || '';

        // Get address
        const addressParts = fullText.split('\n');
        const address = addressParts.find(l => /\d+.*(?:rua|av|alameda|rod|br-|bairro)/i.test(l) || /\d{5}-?\d{3}/.test(l)) || '';

        results.push({ name, rating, reviews, category, address, phone: phoneMatch?.[1] || '' });
      }
      return results;
    }, limit);

    const results = businesses.map(b => ({
      fonte: 'Google Negócios',
      nome: b.name,
      email: '',
      telefone: b.phone || '',
      whatsapp: (b.phone || '').replace(/\D/g, ''),
      empresa: b.name,
      endereco: b.address,
      cidade: '',
      estado: '',
      website: '',
      descricao: `${b.category} ${b.rating ? '- Nota: ' + b.rating : ''} ${b.reviews ? '(' + b.reviews + ')' : ''}`.trim(),
      url_origem: url,
    }));

    res.json({ results, total: results.length });

  } catch (error) {
    console.error('[Google Negocios] Error:', error.message);
    res.json({ results: [], total: 0, error: error.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// Bing scraping - uses Bing Maps search
app.post('/bing', auth, async (req, res) => {
  const { query, limit = 10 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  let browser;
  try {
    console.log(`[Bing] Searching: "${query}" (limit: ${limit})`);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setDefaultTimeout(30000);

    // Try Bing Maps with explicit location in query
    const searchQuery = `${query} -pt-BR brasil`;
    const url = `https://www.bing.com/maps?q=${encodeURIComponent(searchQuery)}&FORM=HDRSC6`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(6000);

    // Extract results from Bing Maps side panel
    const businesses = await page.evaluate((maxResults) => {
      const results = [];
      const seen = new Set();

      // Try various Bing Maps selectors
      const cards = document.querySelectorAll('[class*="card"], .br-poi, .b_entityTl, [data-list], li[role="option"]');

      for (const card of cards) {
        if (results.length >= maxResults) break;

        const nameEl = card.querySelector('h2, [class*="title"], a[aria-label]');
        const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('aria-label') || '';
        if (!name || seen.has(name) || name.length < 3) continue;
        seen.add(name);

        const fullText = card.innerText || '';
        const phoneMatch = fullText.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);
        const addrEl = card.querySelector('[class*="address"]');
        const address = addrEl?.textContent?.trim() || '';
        const linkEl = card.querySelector('a[href]');
        const website = linkEl?.href || '';

        results.push({ name, phone: phoneMatch?.[1] || '', address, website });
      }

      // Fallback: try extracting all link texts from map results
      if (results.length === 0) {
        const allLinks = document.querySelectorAll('a[aria-label]');
        for (const link of allLinks) {
          if (results.length >= maxResults) break;
          const label = link.getAttribute('aria-label') || '';
          if (label.length > 5 && !seen.has(label) && !/bing|maps|menu|search|sign/i.test(label)) {
            seen.add(label);
            results.push({ name: label, phone: '', address: '', website: '' });
          }
        }
      }

      return results;
    }, limit);

    const results = businesses.map(b => ({
      fonte: 'Bing',
      nome: b.name,
      email: '',
      telefone: b.phone,
      whatsapp: (b.phone || '').replace(/\D/g, ''),
      empresa: b.name,
      endereco: b.address,
      cidade: '',
      estado: '',
      website: b.website,
      descricao: 'Bing Maps',
      url_origem: url,
    }));

    res.json({ results, total: results.length });

  } catch (error) {
    console.error('[Bing] Error:', error.message);
    res.json({ results: [], total: 0, error: error.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// Combined search (all sources)
app.post('/search', auth, async (req, res) => {
  const { query, sources = ['google-maps', 'google-negocios', 'bing'], limit = 10 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  const allResults = [];
  const errors = [];

  for (const source of sources) {
    try {
      const response = await fetch(`http://localhost:${PORT}/${source}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ query, limit }),
      });
      const data = await response.json();
      if (data.results) allResults.push(...data.results);
    } catch (e) {
      errors.push({ source, error: e.message });
    }
  }

  res.json({
    results: allResults,
    total: allResults.length,
    errors,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Scraping service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
