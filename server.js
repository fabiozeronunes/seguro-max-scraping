const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SCRAPING_API_KEY || 'seguro-max-scraping-2024';

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
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    
    // Navigate to Google Maps search
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // Wait for results to load
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
    console.error('Google Maps error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Google Negócios (Local Search) scraping
app.post('/google-negocios', auth, async (req, res) => {
  const { query, limit = 10 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    
    // Navigate to Google search with local results
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=br`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    
    // Extract local business results
    const businesses = await page.evaluate((maxResults) => {
      const results = [];
      
      // Method 1: Local pack results
      const localCards = document.querySelectorAll('.VkpGBb, [data-attrid="kc:/local:one box"], .rllt__details');
      
      for (const card of localCards) {
        if (results.length >= maxResults) break;
        
        const nameEl = card.querySelector('.dbg0pd, .OSrXXb, [role="heading"]');
        const name = nameEl?.textContent?.trim() || '';
        
        const ratingEl = card.querySelector('.yi40Hd, .BTtC6e');
        const rating = ratingEl?.textContent?.trim() || '';
        
        const reviewsEl = card.querySelector('.rst9');
        const reviews = reviewsEl?.textContent?.replace(/[()]/g, '').trim() || '';
        
        const categoryEl = card.querySelector('.rllt__details div:nth-child(2) span');
        const category = categoryEl?.textContent?.trim() || '';
        
        const addressEl = card.querySelector('.rllt__details div:nth-child(3) span, .rllt__details div:nth-child(2) div:nth-child(2) span');
        const address = addressEl?.textContent?.trim() || '';
        
        if (name) {
          results.push({ name, rating, reviews, category, address });
        }
      }
      
      // Method 2: Alternative selectors
      if (results.length === 0) {
        const altCards = document.querySelectorAll('[data-attrid*="local"]');
        for (const card of altCards) {
          if (results.length >= maxResults) break;
          const name = card.querySelector('[role="heading"]')?.textContent?.trim() || '';
          const text = card.innerText || '';
          const phoneMatch = text.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);
          
          if (name) {
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
    console.error('Google Negócios error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Bing scraping
app.post('/bing', auth, async (req, res) => {
  const { query, limit = 10 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-BR&cc=BR`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    
    // Extract search results
    const businesses = await page.evaluate((maxResults) => {
      const results = [];
      
      const items = document.querySelectorAll('.b_algo, .b_ans');
      
      for (const item of items) {
        if (results.length >= maxResults) break;
        
        const titleEl = item.querySelector('h2 a, h2');
        const title = titleEl?.textContent?.trim() || '';
        const link = titleEl?.href || '';
        
        const snippetEl = item.querySelector('.b_caption p, .b_algoSlug');
        const snippet = snippetEl?.textContent?.trim() || '';
        
        // Extract phone from snippet
        const phoneMatch = snippet.match(/(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/);
        const phone = phoneMatch ? phoneMatch[1] : '';
        
        // Extract email from snippet
        const emailMatch = snippet.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const email = emailMatch ? emailMatch[1] : '';
        
        if (title) {
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
    console.error('Bing error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
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

app.listen(PORT, () => {
  console.log(`Scraping service running on port ${PORT}`);
});
