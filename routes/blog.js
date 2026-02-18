const express = require('express');
const { marked } = require('marked');
const router = express.Router();
const db = require('../db/database');

router.get('/', (req, res) => {
  const posts = db.listPublishedPosts();
  res.render('blog/index', { posts });
});

router.get('/:slug', (req, res) => {
  const post = db.getPostBySlug(req.params.slug);
  if (!post) {
    return res.status(404).render('blog/404');
  }
  post.bodyHtml = marked(post.body || '');
  res.render('blog/post', { post });
});

module.exports = router;
