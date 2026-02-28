export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { question, dashboardContext } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const systemPrompt = `You are LandMarq AI, an intelligent CRE (Commercial Real Estate) assistant embedded in a broker's dashboard. You have access to the user's live dashboard data provided below. Answer questions conversationally but with data-driven precision. Reference specific numbers, deal names, submarkets, and metrics from the data.

Keep responses concise (2-4 paragraphs max). Use HTML formatting: <strong> for emphasis, <br> for line breaks. Do not use markdown. When listing items, use numbered lines with <br> tags, not bullet points or markdown lists.

DASHBOARD DATA:
${dashboardContext}

GUIDELINES:
- Always reference specific data points (dollar amounts, percentages, deal names, vacancy rates)
- Be proactive — suggest next steps or flag risks when relevant
- If asked to compare things, structure the comparison clearly
- If the data doesn't contain what's asked, say so honestly but suggest what related data you can help with
- Sign off suggestions with actionable next steps when appropriate`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'AI service error', details: response.status });
    }

    const data = await response.json();
    const aiResponse = data.content?.[0]?.text || 'No response generated.';

    return res.status(200).json({ response: aiResponse });

  } catch (err) {
    console.error('AI handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
