const express = require('express');
const router = express.Router();
const db = require('../db/database');

const SITE_URL = 'https://www.sullivantrading.com';

// Static pages
const staticPages = [
  { url: '/',      priority: '1.0', changefreq: 'weekly' },
  { url: '/blog',  priority: '0.8', changefreq: 'weekly' },
];

// ---- SITEMAP ----
router.get('/sitemap.xml', (req, res) => {
  const posts = db.listPublishedPosts();
  const today = new Date().toISOString().split('T')[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

  for (const page of staticPages) {
    xml += `  <url>
    <loc>${SITE_URL}${page.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>
`;
  }

  for (const post of posts) {
    const rawDate = post.updated_at || post.published_at || today;
    const lastmod = rawDate.split(/[T ]/)[0];
    xml += `  <url>
    <loc>${SITE_URL}/blog/${post.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
  }

  xml += `</urlset>`;
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// ---- ROBOTS.TXT ----
router.get('/robots.txt', (req, res) => {
  const robotsTxt = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
  res.set('Content-Type', 'text/plain');
  res.send(robotsTxt);
});

// ---- 301 REDIRECTS FOR OLD URLs ----
// Old viacanseamers / Webnode-era pages still indexed by Google.
// Redirect to relevant sections on the new site.
const oldUrlRedirects = {
  '/machine-inventory/':          '/#inventory',
  '/machine-inventory':           '/#inventory',
  '/products-and-services/':      '/#services',
  '/products-and-services':       '/#services',
  '/repair-service/':             '/#services',
  '/repair-service':              '/#services',
  '/replacement-manual-prints/':  '/#manuals',
  '/replacement-manual-prints':   '/#manuals',
  '/faqs/':                       '/#faq',
  '/faqs':                        '/#faq',
  '/blank-page/':                 '/',
  '/blank-page':                  '/',
  '/seamer-rebuilds/':            '/#rebuilds',
  '/seamer-rebuilds':             '/#rebuilds',
  '/canseamers.html':             '/',
};

for (const [oldPath, newPath] of Object.entries(oldUrlRedirects)) {
  router.get(oldPath, (req, res) => {
    res.redirect(301, newPath);
  });
}

module.exports = router;
