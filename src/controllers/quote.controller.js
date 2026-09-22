const quotes = require('../data/motivationalQuotes');

// یک جمله‌ی تصادفی از بانک جملات برمی‌گرداند، برای پر کردن باکس پیام استاد
function getRandomQuote(req, res) {
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  res.json({ quote });
}

module.exports = { getRandomQuote };
