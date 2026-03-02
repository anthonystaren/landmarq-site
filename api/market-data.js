// Vercel Serverless Function — Market Data Proxy
// Fetches from FRED, SEC EDGAR, and BLS APIs to avoid CORS issues
module.exports = async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { source, series, cik } = req.query;

  try {
    // ─── FRED (Federal Reserve Economic Data) ───
    if (source === 'fred') {
      const fredKey = process.env.FRED_API_KEY || 'DEMO_KEY';
      const seriesId = series || 'MORTGAGE30US';
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=24`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`FRED API error: ${resp.status}`);
      const data = await resp.json();
      return res.status(200).json({
        source: 'FRED',
        series: seriesId,
        observations: (data.observations || []).map(o => ({
          date: o.date,
          value: o.value === '.' ? null : parseFloat(o.value)
        })).filter(o => o.value !== null),
        fetched: new Date().toISOString()
      });
    }

    // ─── SEC EDGAR (REIT Filings) ───
    if (source === 'edgar') {
      // Fetch recent filings for CRE-related companies
      const ciks = (cik || '').split(',').filter(Boolean);
      const reitCIKs = ciks.length > 0 ? ciks : [
        '0001364250', // Prologis (PLD) — Industrial REIT
        '0001063761', // Simon Property Group (SPG) — Retail REIT
        '0000726728', // Realty Income (O) — Net Lease REIT
        '0001035443', // Digital Realty (DLR) — Data Center REIT
        '0001579298', // CBRE Group (CBRE) — CRE Services
        '0000045012', // BXP (Boston Properties) — Office REIT
        '0001393311', // JLL (Jones Lang LaSalle)
        '0000036104', // Vornado Realty Trust — Office/Retail
      ];

      const filings = [];
      for (const c of reitCIKs.slice(0, 8)) {
        try {
          const url = `https://data.sec.gov/submissions/CIK${c.padStart(10, '0')}.json`;
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'LandMarq Intelligence Platform support@landmarq.ai' }
          });
          if (!resp.ok) continue;
          const data = await resp.json();
          const recent = data.filings?.recent || {};
          const forms = recent.form || [];
          const dates = recent.filingDate || [];
          const descs = recent.primaryDocDescription || [];
          const accessions = recent.accessionNumber || [];

          // Get last 5 relevant filings (8-K, 10-K, 10-Q)
          for (let i = 0; i < Math.min(forms.length, 50); i++) {
            if (['8-K', '10-K', '10-Q', '8-K/A'].includes(forms[i])) {
              filings.push({
                company: data.name,
                ticker: data.tickers?.[0] || '',
                form: forms[i],
                date: dates[i],
                description: descs[i] || '',
                accession: accessions[i],
                url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c}&type=${forms[i]}&dateb=&owner=exclude&count=5`
              });
              if (filings.filter(f => f.company === data.name).length >= 3) break;
            }
          }
        } catch (e) {
          console.error(`EDGAR fetch error for CIK ${c}:`, e.message);
        }
      }

      // Sort by date descending
      filings.sort((a, b) => new Date(b.date) - new Date(a.date));

      return res.status(200).json({
        source: 'SEC EDGAR',
        filings: filings.slice(0, 20),
        fetched: new Date().toISOString()
      });
    }

    // ─── BLS (Bureau of Labor Statistics) ───
    if (source === 'bls') {
      // CRE-relevant employment series
      const seriesIds = [
        'CES2000000001', // Construction employment (national)
        'CES5553000001', // Real estate employment (national)
        'CES0000000001', // Total nonfarm (national)
        'CES7000000001', // Leisure/hospitality (demand indicator)
      ];
      const url = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesid: seriesIds,
          startyear: String(new Date().getFullYear() - 1),
          endyear: String(new Date().getFullYear())
        })
      });
      if (!resp.ok) throw new Error(`BLS API error: ${resp.status}`);
      const data = await resp.json();

      const seriesLabels = {
        'CES2000000001': 'Construction Employment',
        'CES5553000001': 'Real Estate Employment',
        'CES0000000001': 'Total Nonfarm Payrolls',
        'CES7000000001': 'Leisure & Hospitality Employment'
      };

      const results = (data.Results?.series || []).map(s => ({
        id: s.seriesID,
        label: seriesLabels[s.seriesID] || s.seriesID,
        data: (s.data || []).slice(0, 12).map(d => ({
          year: d.year,
          period: d.periodName,
          value: parseFloat(d.value) * 1000, // BLS reports in thousands
          change: d.calculations?.net_changes?.['1'] || null,
          pctChange: d.calculations?.pct_changes?.['1'] || null
        }))
      }));

      return res.status(200).json({
        source: 'BLS',
        series: results,
        fetched: new Date().toISOString()
      });
    }

    // ─── FRED Multi-Series (Dashboard Summary) ───
    if (source === 'summary') {
      const fredKey = process.env.FRED_API_KEY || 'DEMO_KEY';
      const indicators = [
        { id: 'MORTGAGE30US', label: '30-Yr Mortgage Rate', format: 'pct' },
        { id: 'FEDFUNDS', label: 'Fed Funds Rate', format: 'pct' },
        { id: 'UNRATE', label: 'Unemployment Rate', format: 'pct' },
        { id: 'CPIAUCSL', label: 'CPI (Inflation)', format: 'index' },
        { id: 'INDPRO', label: 'Industrial Production', format: 'index' },
        { id: 'HOUST', label: 'Housing Starts (000s)', format: 'num' },
      ];

      const results = [];
      for (const ind of indicators) {
        try {
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${ind.id}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=2`;
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const data = await resp.json();
          const obs = (data.observations || []).filter(o => o.value !== '.');
          if (obs.length >= 1) {
            const current = parseFloat(obs[0].value);
            const prev = obs.length >= 2 ? parseFloat(obs[1].value) : null;
            results.push({
              id: ind.id,
              label: ind.label,
              value: current,
              previous: prev,
              change: prev != null ? current - prev : null,
              pctChange: prev != null && prev !== 0 ? ((current - prev) / prev * 100) : null,
              date: obs[0].date,
              format: ind.format
            });
          }
        } catch (e) {
          console.error(`FRED series ${ind.id} error:`, e.message);
        }
      }

      return res.status(200).json({
        source: 'FRED + BLS',
        indicators: results,
        fetched: new Date().toISOString()
      });
    }

    return res.status(400).json({ error: 'Unknown source. Use: fred, edgar, bls, or summary' });

  } catch (err) {
    console.error('Market data proxy error:', err);
    return res.status(500).json({ error: 'Proxy error', message: err.message });
  }
};
