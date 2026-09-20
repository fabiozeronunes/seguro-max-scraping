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

// Google Negócios (Local Search) scraping
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

    // Use Google search with explicit Brazilian locale
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=br&num=${limit + 5}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(2000);
    
    // Extract local business results using broad selectors
    const businesses = await page.evaluate((maxResults) => {
      const results = [];
      const seen = new Set();
      
      // Method 1: Local pack - try multiple modern selectors
      const selectors = [
        '.VkpGBb', '[data-attrid="kc:/local:one box"]',
        '.rllt__details', '.dbg0pd',
        'div[data-local-attribute]', '.luUGC',
        '[jsname] > div > div > a[data-ved]'
      ];
      
      for (const sel of selectors) {
        if (results.length >= maxResults) break;
        const cards = document.querySelectorAll(sel);
        for (const card of cards) {
          if (results.length >= maxResults) break;
          
          // Find name: heading, link text, or first significant text
          const nameEl = card.closest('[data-attrid]')?.querySelector('[role="heading"]')
            || card.querySelector('[role="heading"], .dbg0pd, .OSrXXb, span[lang]')
            || card;
          const name = nameEl?.textContent?.trim()?.substring(0, 100) || '';
          if (!name || seen.has(name) || name.length < 3) continue;
          
          // Get full text of the card for phone/address extraction
          const cardContainer = card.closest('[data-attrid]') || card.parentElement || card;
          const fullText = cardContainer?.innerText || card.innerText || '';
          
          // Extract phone
          const phoneMatch = fullText.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);
          const phone = phoneMatch ? phoneMatch[1] : '';
          
          // Extract address (lines after name, before phone)
          const lines = fullText.split('\n').filter(l => l.trim().length > 3);
          let address = '';
          for (const line of lines) {
            if (/\d{5}-?\d{3}/.test(line) || /rua|av|alameda|travessa|rodovia/i.test(line)) {
              address = line.trim().substring(0, 100);
              break;
            }
          }
          
          seen.add(name);
          results.push({ name, rating: '', reviews: '', category: '', address, phone });
        }
      }
      
      // Method 2: If nothing found, try generic approach with aria labels
      if (results.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/maps/place"]');
        for (const link of allLinks) {
          if (results.length >= maxResults) break;
          const name = link.getAttribute('aria-label') || link.textContent?.trim() || '';
          if (name && name.length > 3 && !seen.has(name)) {
            seen.add(name);
            results.push({ name, rating: '', reviews: '', category: '', address: '', phone: '' });
          }
        }
      }
      
      // Method 3: Last resort - extract from visible text blocks
      if (results.length === 0) {
        const blocks = document.querySelectorAll('.g, [data-header-feature]');
        for (const block of blocks) {
          if (results.length >= maxResults) break;
          const heading = block.querySelector('h3');
          const name = heading?.textContent?.trim() || '';
          const text = block.innerText || '';
          const phoneMatch = text.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);
          
          if (name && (phoneMatch || /oficina|mecânica|auto/i.test(name))) {
            seen.add(name);
            results.push({ name, rating: '', reviews: '', category: '', address: '', phone: phoneMatch?.[1] || '' });
          }
        }
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
      descricao: `${b.category} ${b.rating ? '- Nota: ' + b.rating : ''}`.trim(),
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

// Bing scraping
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
    
    // Force Brazilian Portuguese locale via headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9',
    });
    
    // Force Brazilian Portuguese locale
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=pt-BR&setlang=pt-BR&cc=BR&count=${limit + 5}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3000);
    
    // Extract search results
    const businesses = await page.evaluate((maxResults) => {
      const results = [];
      const seen = new Set();
      
      // Only use .b_algo (organic results), skip .b_ans (ads/answers)
      const items = document.querySelectorAll('.b_algo');
      
      for (const item of items) {
        if (results.length >= maxResults) break;
        
        const titleEl = item.querySelector('h2 a, h2');
        const title = titleEl?.textContent?.trim() || '';
        const link = titleEl?.href || '';
        
        const snippetEl = item.querySelector('.b_caption p, .b_algoSlug, .b_lineclamp2');
        const snippet = snippetEl?.textContent?.trim() || '';
        
        const fullText = `${title} ${snippet}`;
        
        // Extract phone from snippet
        const phoneMatch = fullText.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);
        const phone = phoneMatch ? phoneMatch[1] : '';
        
        // Extract email from snippet
        const emailMatch = fullText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const email = emailMatch ? emailMatch[1] : '';
        
        // Filter: skip irrelevant results (ads, downloads, etc)
        if (title && !seen.has(title) && !/download|curso|grátis|coursera|udemy/i.test(title)) {
          seen.add(title);
          results.push({ title, link, snippet, phone, email });
        }
      }
      
      return results;
    }, limit);
    
    const results = businesses.map(b => ({
      fonte: 'Bing',
      nome: b.title,
      email: b.email,
      telefone: b.phone,
      whatsapp: (b.phone || '').replace(/\D/g, ''),
      empresa: b.title,
      endereco: '',
      cidade: '',
      estado: '',
      website: b.link,
      descricao: b.snippet.substring(0, 200),
      url_origem: b.link,
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
