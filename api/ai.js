module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY in Vercel Environment Variables.' });
  }

  try {
    const { question, dashboardContext } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const systemPrompt = `You are LandMarq AI, a sharp CRE (Commercial Real Estate) analyst embedded in a broker's dashboard. You have the user's LIVE dashboard data below.

CRITICAL RULES:
1. ANSWER THE SPECIFIC QUESTION ASKED. Do not give a generic pipeline overview unless that's what was asked.
2. If asked "which deals are not worth my time" — identify the lowest probability, smallest value deals and explain why they're weak.
3. If asked "what's my best deal" — identify the single best deal by value × probability and explain why.
4. If asked to compare things — structure a clear comparison with specific numbers.
5. Always cite specific deal names, dollar amounts, probabilities, and market names from the data.
6. Be direct and opinionated. Give a clear recommendation, not a wishy-washy summary.
7. Keep responses focused — 2-3 short paragraphs max. Quality over quantity.

FORMAT: Use HTML only. <strong> for emphasis, <br><br> for paragraph breaks. No markdown. No bullet points with - or *. Use numbered items with <br> for lists.

${dashboardContext}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'AI service error', status: response.status, details: errText });
    }

    const data = await response.json();
    const aiResponse = data.content?.[0]?.text || 'No response generated.';

    return res.status(200).json({ response: aiResponse });

  } catch (err) {
    console.error('AI handler error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
