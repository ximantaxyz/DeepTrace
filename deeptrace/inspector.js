const https = require('https');
const http = require('http');
const { URL } = require('url');
const { JSDOM } = require('jsdom');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
];

const MAX_CONCURRENT = 3;
const FETCH_TIMEOUT = 15000;
const MIN_TEXT_LENGTH = 200;
const MAX_TEXT_LENGTH = 50000;
const MIN_DELAY = 300;
const MAX_DELAY = 900;
const MAX_EXPANDED_URLS = 25;

const JUNK_PHRASES = [
  'cookie policy',
  'privacy policy',
  'terms of service',
  'terms and conditions',
  'accept cookies',
  'manage cookies',
  'cookie settings',
  'we use cookies',
  'this website uses cookies',
  'by continuing to use',
  'gdpr',
  'data protection',
  'cookie consent',
  'privacy notice',
  'legal notice'
];

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    await new Promise(resolve => this.queue.push(resolve));
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}

function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    url.hash = '';
    
    if (url.search) {
      const params = new URLSearchParams(url.search);
      const filtered = new URLSearchParams();
      
      for (const [key, value] of params.entries()) {
        const lowerKey = key.toLowerCase();
        if (!lowerKey.startsWith('utm_') && lowerKey !== 'ref' && lowerKey !== 'fbclid') {
          filtered.append(key, value);
        }
      }
      
      const sortedParams = new URLSearchParams([...filtered.entries()].sort());
      url.search = sortedParams.toString();
    }
    
    return url.toString().replace(/\/$/, '');
  } catch {
    return urlString;
  }
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay() {
  const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function fetchWithTimeout(url, timeout, abortSignal) {
  return new Promise((resolve, reject) => {
    if (abortSignal && abortSignal.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const timeoutId = setTimeout(() => {
      req.destroy();
      reject(new Error('Timeout'));
    }, timeout);

    const req = protocol.get(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: timeout
    }, (res) => {
      if (abortSignal && abortSignal.aborted) {
        req.destroy();
        clearTimeout(timeoutId);
        reject(new Error('Aborted'));
        return;
      }

      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeoutId);
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchWithTimeout(redirectUrl, timeout, abortSignal)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        clearTimeout(timeoutId);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('text/html')) {
        clearTimeout(timeoutId);
        reject(new Error('Not HTML'));
        return;
      }

      let data = '';
      res.on('data', chunk => {
        if (abortSignal && abortSignal.aborted) {
          req.destroy();
          clearTimeout(timeoutId);
          reject(new Error('Aborted'));
          return;
        }
        data += chunk;
        if (data.length > MAX_TEXT_LENGTH * 2) {
          req.destroy();
          clearTimeout(timeoutId);
          reject(new Error('Response too large'));
        }
      });

      res.on('end', () => {
        clearTimeout(timeoutId);
        resolve(data);
      });

      res.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        req.destroy();
        clearTimeout(timeoutId);
        reject(new Error('Aborted'));
      });
    }
  });
}

function removeJunkText(text) {
  let cleaned = text;

  for (const phrase of JUNK_PHRASES) {
    const regex = new RegExp(`\\b${phrase}\\b[^.!?]*[.!?]?`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

function extractTextAndLinks(html, baseUrl) {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const selectorsToRemove = [
      'script',
      'style',
      'noscript',
      'iframe',
      'nav',
      'header',
      'footer',
      'aside',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="complementary"]',
      '.advertisement',
      '.ad',
      '.sidebar',
      '.menu',
      '.cookie-banner',
      '.cookie-notice',
      '.gdpr-banner',
      '#cookie-consent',
      '[class*="cookie"]',
      '[id*="cookie"]',
      '[class*="privacy"]',
      '[class*="gdpr"]'
    ];

    selectorsToRemove.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => el.remove());
    });

    const title = document.querySelector('title')?.textContent?.trim() || '';
    const bodyText = document.body?.textContent || '';

    let cleanedText = bodyText
      .replace(/\s+/g, ' ')
      .trim();

    cleanedText = removeJunkText(cleanedText);
    cleanedText = cleanedText.substring(0, MAX_TEXT_LENGTH);

    const links = [];
    try {
      const baseUrlObj = new URL(baseUrl);
      const baseDomain = baseUrlObj.hostname;

      document.querySelectorAll('a[href]').forEach(anchor => {
        try {
          const href = anchor.getAttribute('href');
          if (!href) return;

          const absoluteUrl = new URL(href, baseUrl).toString();
          const linkUrl = new URL(absoluteUrl);

          if (linkUrl.hostname === baseDomain) {
            links.push(absoluteUrl);
          }
        } catch {}
      });
    } catch {}

    return { title, text: cleanedText, links };
  } catch {
    return { title: '', text: '', links: [] };
  }
}

async function inspectPage(url, abortSignal) {
  try {
    const html = await fetchWithTimeout(url, FETCH_TIMEOUT, abortSignal);
    const { title, text, links } = extractTextAndLinks(html, url);

    if (text.length < MIN_TEXT_LENGTH) {
      return null;
    }

    return {
      url,
      title,
      extractedText: text,
      links,
      timestamp: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

async function inspectQuestion(questionNode, seedUrls, shouldStopFn, onPageCountUpdate) {
  const visitedUrls = new Set();
  const semaphore = new Semaphore(MAX_CONCURRENT);
  const abortController = new AbortController();
  
  let pageCount = 0;
  let aborted = false;

  const shouldAbort = () => {
    if (aborted) return true;
    if (shouldStopFn()) {
      aborted = true;
      abortController.abort();
      return true;
    }
    return false;
  };

  const processUrl = async (url, depth) => {
    if (shouldAbort()) {
      return;
    }

    const normalizedUrl = normalizeUrl(url);
    if (visitedUrls.has(normalizedUrl)) {
      return;
    }
    visitedUrls.add(normalizedUrl);

    await semaphore.acquire();

    if (shouldAbort()) {
      semaphore.release();
      return;
    }

    try {
      await randomDelay();

      if (shouldAbort()) {
        return;
      }

      const result = await inspectPage(url, abortController.signal);

      if (result && !shouldAbort()) {
        pageCount++;
        onPageCountUpdate(pageCount);

        if (depth === 0 && result.links && result.links.length > 0) {
          const expandedUrls = [];
          
          for (const link of result.links) {
            if (expandedUrls.length >= MAX_EXPANDED_URLS) break;
            
            const normalizedLink = normalizeUrl(link);
            if (!visitedUrls.has(normalizedLink)) {
              expandedUrls.push(link);
            }
          }

          const expandTasks = expandedUrls.map(expandUrl => processUrl(expandUrl, 1));
          await Promise.all(expandTasks);
        }
      }
    } finally {
      semaphore.release();
    }
  };

  const seedTasks = seedUrls.map(url => processUrl(url, 0));
  await Promise.all(seedTasks);
}

module.exports = {
  inspectQuestion
};
