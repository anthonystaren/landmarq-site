// Vercel Serverless Function — Market Data Proxy
// Fetches from 25+ data sources: FRED, SEC EDGAR, BLS, Treasury, Polymarket, Kalshi,
// FEMA, USGS, EPA, FBI, CFPB, Census ACS, Yahoo Finance, VIX, and macro bundle
module.exports = async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { source, series, cik, address, symbol, station, state, zip } = req.query;

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

    // ─── US Treasury (Yield Curve Data) ───
    if (source === 'treasury') {
      try {
        const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=10';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Treasury API error: ${resp.status}`);
        const data = await resp.json();
        const records = (data.data || []).map(r => ({
          date: r.record_date,
          rate_type: r.interest_rate_type,
          rate: parseFloat(r.interest_rate),
          avg_daily_balance: parseFloat(r.avg_daily_balance || 0)
        }));
        return res.status(200).json({
          source: 'US Treasury',
          records: records,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Treasury fetch failed', message: e.message });
      }
    }

    // ─── Polymarket (Prediction Markets — Economics) ───
    if (source === 'polymarket') {
      try {
        const url = 'https://gamma-api.polymarket.com/markets?tag=economics&closed=false&limit=10';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Polymarket API error: ${resp.status}`);
        const data = await resp.json();
        const markets = (data || []).map(m => ({
          id: m.id,
          question: m.question,
          tag: m.tag,
          volumes: m.volumes,
          active_order_ids: (m.active_order_ids || []).length,
          closed: m.closed,
          updated_at: m.updated_at
        }));
        return res.status(200).json({
          source: 'Polymarket',
          markets: markets,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Polymarket fetch failed', message: e.message });
      }
    }

    // ─── Kalshi (Prediction Markets — Fed Rates, Recession) ───
    if (source === 'kalshi') {
      try {
        const url = 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=20';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Kalshi API error: ${resp.status}`);
        const data = await resp.json();
        const contracts = (data.markets || []).map(m => ({
          id: m.id,
          title: m.title,
          subtitle: m.subtitle,
          category: m.category,
          status: m.status,
          open_interest: m.open_interest,
          volume_24h: m.volume_24h,
          created_at: m.created_at,
          closes_at: m.closes_at
        }));
        return res.status(200).json({
          source: 'Kalshi',
          contracts: contracts,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Kalshi fetch failed', message: e.message });
      }
    }

    // ─── FEMA (OpenFEMA Disaster Declarations) ───
    if (source === 'fema') {
      try {
        const url = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$orderby=declarationDate desc&$top=15';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`FEMA API error: ${resp.status}`);
        const data = await resp.json();
        const declarations = (data.DisasterDeclarationsSummaries || []).map(d => ({
          id: d.disasterId,
          state: d.state,
          type: d.declarationType,
          declaration_date: d.declarationDate,
          incident_type: d.incidentType,
          incident_begin: d.incidentBeginDate,
          title: d.disasterNumber,
          fips_code: d.fipsCode
        }));
        return res.status(200).json({
          source: 'FEMA',
          declarations: declarations,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'FEMA fetch failed', message: e.message });
      }
    }

    // ─── USGS Earthquake Data ───
    if (source === 'earthquake') {
      try {
        const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`USGS API error: ${resp.status}`);
        const data = await resp.json();
        const earthquakes = (data.features || []).map(f => ({
          magnitude: f.properties.mag,
          place: f.properties.place,
          time: new Date(f.properties.time).toISOString(),
          depth: f.geometry.coordinates[2],
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
          usgs_id: f.id,
          alert_level: f.properties.alert,
          tsunami: f.properties.tsunami
        }));
        return res.status(200).json({
          source: 'USGS Earthquakes',
          earthquakes: earthquakes,
          count: earthquakes.length,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'USGS fetch failed', message: e.message });
      }
    }

    // ─── EPA TRI (Toxic Release Inventory) ───
    if (source === 'epa') {
      try {
        const url = 'https://enviro.epa.gov/enviro/efservice/tri_facility/rows/0:20/JSON';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`EPA API error: ${resp.status}`);
        const data = await resp.json();
        const facilities = (data || []).map(f => ({
          facility_id: f.REGISTRY_ID,
          facility_name: f.FACILITY_NAME,
          location: f.LOCATION_CITY + ', ' + f.LOCATION_STATE,
          zip: f.LOCATION_ZIP_CODE,
          primary_naics: f.PRIMARY_NAICS_CODE,
          total_releases: f.TOTAL_RELEASES
        }));
        return res.status(200).json({
          source: 'EPA TRI',
          facilities: facilities,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'EPA fetch failed', message: e.message });
      }
    }

    // ─── FBI Crime Data ───
    if (source === 'crime') {
      try {
        const apiKey = process.env.FBI_CRIME_KEY || 'iiHnOKfno2Mgkt5AynpvPpUQTEyxE77jo1RU8PIv';
        const url = `https://api.usa.gov/crime/fbi/cde/arrest/national/all?from=2020&to=2023&API_KEY=${apiKey}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`FBI Crime API error: ${resp.status}`);
        const data = await resp.json();
        const arrests = (data.data || []).map(d => ({
          year: d.year,
          total_arrests: parseInt(d.total, 10),
          age_18_plus: parseInt(d.age_18_plus || 0, 10),
          age_under_18: parseInt(d.age_under_18 || 0, 10)
        }));
        return res.status(200).json({
          source: 'FBI Crime Data',
          arrests: arrests,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'FBI Crime fetch failed', message: e.message });
      }
    }

    // ─── CFPB HMDA (Mortgage Lending Data) ───
    if (source === 'hmda') {
      try {
        const url = 'https://ffiec.cfpb.gov/v2/data-browser-api/view/nationwide/aggregations?actions_taken=1&years=2022';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HMDA API error: ${resp.status}`);
        const data = await resp.json();
        const originations = {
          year: data.year || 2022,
          total_applications: data.total_applications,
          total_originations: data.total_originations,
          total_denials: data.total_denials,
          median_loan_amount: data.median_loan_amount,
          median_income: data.median_income,
          ethnicity_data: data.ethnicity_data || [],
          race_data: data.race_data || []
        };
        return res.status(200).json({
          source: 'CFPB HMDA',
          originations: originations,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'HMDA fetch failed', message: e.message });
      }
    }

    // ─── Walk Score (Neighborhood Walkability) ───
    if (source === 'walkscore') {
      try {
        const key = process.env.WALKSCORE_KEY;
        if (!key) throw new Error('WALKSCORE_KEY not configured');
        if (!address) throw new Error('address parameter required');
        const encodedAddress = encodeURIComponent(address);
        const url = `https://api.walkscore.com/score?format=json&address=${encodedAddress}&wsapikey=${key}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Walk Score API error: ${resp.status}`);
        const data = await resp.json();
        return res.status(200).json({
          source: 'Walk Score',
          address: data.address,
          walk_score: data.walk_score,
          walk_description: data.description,
          transit_score: data.transit_score,
          bike_score: data.bike_score,
          latitude: data.latitude,
          longitude: data.longitude,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Walk Score fetch failed', message: e.message });
      }
    }

    // ─── News API (Commercial Real Estate News) ───
    if (source === 'news') {
      try {
        const key = process.env.NEWS_API_KEY;
        if (!key) throw new Error('NEWS_API_KEY not configured');
        const url = `https://newsapi.org/v2/everything?q=commercial+real+estate&sortBy=publishedAt&pageSize=10&apiKey=${key}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`News API error: ${resp.status}`);
        const data = await resp.json();
        const articles = (data.articles || []).map(a => ({
          title: a.title,
          description: a.description,
          url: a.url,
          image: a.urlToImage,
          published_at: a.publishedAt,
          source: a.source.name,
          author: a.author
        }));
        return res.status(200).json({
          source: 'News API (CRE)',
          articles: articles,
          total_results: data.totalResults,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'News API fetch failed', message: e.message });
      }
    }

    // ─── Alpha Vantage (REIT Stock Quotes) ───
    if (source === 'reit_quote') {
      try {
        const key = process.env.ALPHA_VANTAGE_KEY;
        if (!key) throw new Error('ALPHA_VANTAGE_KEY not configured');
        if (!symbol) throw new Error('symbol parameter required');
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${key}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Alpha Vantage API error: ${resp.status}`);
        const data = await resp.json();
        const quote = data['Global Quote'] || {};
        return res.status(200).json({
          source: 'Alpha Vantage',
          symbol: quote['01. symbol'],
          price: parseFloat(quote['05. price'] || 0),
          change: parseFloat(quote['09. change'] || 0),
          change_pct: quote['10. change percent'],
          volume: parseInt(quote['06. volume'] || 0, 10),
          timestamp: quote['07. latest trading day'],
          bid: parseFloat(quote['08. bid price'] || 0),
          ask: parseFloat(quote['03. high'] || 0),
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Alpha Vantage fetch failed', message: e.message });
      }
    }

    // ─── Financial Modeling Prep (REIT Financials) ───
    if (source === 'reit_financials') {
      try {
        const key = process.env.FMP_API_KEY;
        if (!key) throw new Error('FMP_API_KEY not configured');
        if (!symbol) throw new Error('symbol parameter required');
        const url = `https://financialmodelingprep.com/api/v3/income-statement/${symbol}?period=annual&limit=3&apikey=${key}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`FMP API error: ${resp.status}`);
        const data = await resp.json();
        const statements = (data || []).map(s => ({
          date: s.date,
          revenue: parseInt(s.revenue || 0, 10),
          operating_income: parseInt(s.operatingIncome || 0, 10),
          net_income: parseInt(s.netIncome || 0, 10),
          eps: parseFloat(s.eps || 0),
          cost_of_revenue: parseInt(s.costOfRevenue || 0, 10)
        }));
        return res.status(200).json({
          source: 'FMP Financials',
          symbol: symbol,
          statements: statements,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'FMP fetch failed', message: e.message });
      }
    }

    // ─── Geocodio (Address Geocoding + Census Data) ───
    if (source === 'geocode') {
      try {
        const key = process.env.GEOCODIO_KEY;
        if (!key) throw new Error('GEOCODIO_KEY not configured');
        if (!address) throw new Error('address parameter required');
        const encodedAddress = encodeURIComponent(address);
        const url = `https://api.geocod.io/v1.7/geocode?q=${encodedAddress}&api_key=${key}&fields=census,cd`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Geocodio API error: ${resp.status}`);
        const data = await resp.json();
        const results = (data.results || []).map(r => ({
          formatted_address: r.formatted_address,
          latitude: r.location.lat,
          longitude: r.location.lng,
          accuracy_type: r.accuracy_type,
          census_block: r.fields.census?.census_block,
          census_tract: r.fields.census?.census_tract,
          place: r.fields.census?.place_name,
          congressional_district: r.fields.cd?.congressional_district
        }));
        return res.status(200).json({
          source: 'Geocodio',
          results: results,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Geocodio fetch failed', message: e.message });
      }
    }

    // ─── HUD Fair Market Rents ───
    if (source === 'hud_fmr') {
      try {
        const token = process.env.HUD_API_TOKEN;
        if (!token) throw new Error('HUD_API_TOKEN not configured');
        if (!state && !zip) throw new Error('state or zip parameter required');

        let url;
        if (state) {
          url = `https://www.huduser.gov/hudapi/public/fmr/statedata/${state}`;
        } else if (zip) {
          url = `https://www.huduser.gov/hudapi/public/fmr/data?year=2023&zip=${zip}`;
        }

        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error(`HUD API error: ${resp.status}`);
        const data = await resp.json();

        const fmr = state
          ? (data.data || []).map(d => ({
              state: d.state,
              fmr_0br: parseFloat(d.fmr_0 || 0),
              fmr_1br: parseFloat(d.fmr_1 || 0),
              fmr_2br: parseFloat(d.fmr_2 || 0),
              fmr_3br: parseFloat(d.fmr_3 || 0),
              fmr_4br: parseFloat(d.fmr_4 || 0),
              county: d.countyname,
              metroname: d.metroname
            }))
          : [{
              fmr_0br: parseFloat(data.FMR_0 || 0),
              fmr_1br: parseFloat(data.FMR_1 || 0),
              fmr_2br: parseFloat(data.FMR_2 || 0),
              fmr_3br: parseFloat(data.FMR_3 || 0),
              fmr_4br: parseFloat(data.FMR_4 || 0),
              zip: zip,
              year: data.year
            }];

        return res.status(200).json({
          source: 'HUD FMR',
          fmr_data: fmr,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'HUD FMR fetch failed', message: e.message });
      }
    }

    // ─── NOAA Climate Data ───
    if (source === 'noaa') {
      try {
        const token = process.env.NOAA_API_TOKEN;
        if (!token) throw new Error('NOAA_API_TOKEN not configured');
        const stationId = station || 'USW00023183'; // Phoenix default
        const url = `https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=${stationId}&startDate=2025-01-01&endDate=2025-12-31&dataTypes=TMAX,TMIN,PRCP&units=standard&format=json`;

        const resp = await fetch(url, {
          headers: { 'token': token }
        });
        if (!resp.ok) throw new Error(`NOAA API error: ${resp.status}`);
        const data = await resp.json();

        const climate = (data.results || []).map(d => ({
          date: d.DATE,
          tmax: parseFloat(d.TMAX || 0),
          tmin: parseFloat(d.TMIN || 0),
          prcp: parseFloat(d.PRCP || 0)
        }));

        return res.status(200).json({
          source: 'NOAA Climate',
          station: stationId,
          data: climate.slice(0, 30), // Last 30 days
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'NOAA fetch failed', message: e.message });
      }
    }

    // ─── SEC XBRL (Structured Financial Data) ───
    if (source === 'xbrl') {
      try {
        if (!cik) throw new Error('cik parameter required');
        const concept = (req.query.concept || 'Revenues').replace(/\s+/g, '');
        const paddedCik = cik.toString().padStart(10, '0');
        const url = `https://data.sec.gov/api/xbrl/companyconcepts/CIK${paddedCik}/us-gaap/${concept}.json`;

        const resp = await fetch(url, {
          headers: { 'User-Agent': 'LandMarq Intelligence Platform support@landmarq.ai' }
        });
        if (!resp.ok) throw new Error(`SEC XBRL API error: ${resp.status}`);
        const data = await resp.json();

        const units = data.units || {};
        let facts = [];
        for (const unitKey in units) {
          const unitFacts = units[unitKey];
          for (const fact of unitFacts) {
            facts.push({
              value: fact.val,
              filed: fact.filed,
              frame: fact.frame,
              unit: unitKey,
              accession: fact.accn,
              form: fact.form,
              end_date: fact.end
            });
          }
        }
        // Sort by date descending
        facts.sort((a, b) => new Date(b.end_date) - new Date(a.end_date));

        return res.status(200).json({
          source: 'SEC XBRL',
          cik: cik,
          concept: concept,
          unit: data.label || 'USD',
          facts: facts.slice(0, 20),
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'SEC XBRL fetch failed', message: e.message });
      }
    }

    // ─── CBOE VIX via FRED (Free — no CBOE subscription needed) ───
    if (source === 'vix') {
      try {
        const fredKey = process.env.FRED_API_KEY || 'DEMO_KEY';
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key=${fredKey}&file_type=json&sort_order=desc&limit=60`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`FRED/VIX API error: ${resp.status}`);
        const data = await resp.json();
        const observations = (data.observations || [])
          .filter(o => o.value !== '.')
          .map(o => ({ date: o.date, value: parseFloat(o.value) }));
        const current = observations[0] || {};
        const prev = observations[1] || {};
        return res.status(200).json({
          source: 'CBOE VIX (via FRED)',
          current: current.value,
          previous: prev.value,
          change: current.value && prev.value ? +(current.value - prev.value).toFixed(2) : null,
          date: current.date,
          history: observations.slice(0, 30),
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'VIX fetch failed', message: e.message });
      }
    }

    // ─── Census Bureau ACS (Housing & Demographics — Free, no key needed) ───
    if (source === 'census') {
      try {
        const stFips = state || '17'; // Default: Illinois
        // ACS 5-Year: median home value, median rent, vacancy rate, total housing units, owner-occupied
        const vars = 'B25077_001E,B25064_001E,B25002_003E,B25002_001E,B25003_002E,NAME';
        const url = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=state:${stFips}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Census API error: ${resp.status}`);
        const data = await resp.json();
        if (data.length < 2) throw new Error('No Census data returned');
        const headers = data[0];
        const values = data[1];
        const row = {};
        headers.forEach((h, i) => { row[h] = values[i]; });
        const totalUnits = parseInt(row.B25002_001E) || 1;
        const vacantUnits = parseInt(row.B25002_003E) || 0;
        return res.status(200).json({
          source: 'US Census Bureau ACS',
          state: row.NAME,
          median_home_value: parseInt(row.B25077_001E) || null,
          median_gross_rent: parseInt(row.B25064_001E) || null,
          total_housing_units: totalUnits,
          vacant_units: vacantUnits,
          vacancy_rate: +((vacantUnits / totalUnits) * 100).toFixed(1),
          owner_occupied: parseInt(row.B25003_002E) || null,
          year: 2022,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Census fetch failed', message: e.message });
      }
    }

    // ─── Census ACS Multi-State (Compare metros for CRE) ───
    if (source === 'census_compare') {
      try {
        const states = (state || '17,06,36,48,12').split(','); // IL,CA,NY,TX,FL
        const vars = 'B25077_001E,B25064_001E,B25002_003E,B25002_001E,NAME';
        const results = [];
        for (const st of states.slice(0, 10)) {
          try {
            const url = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=state:${st.trim()}`;
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data.length < 2) continue;
            const headers = data[0];
            const values = data[1];
            const row = {};
            headers.forEach((h, i) => { row[h] = values[i]; });
            const total = parseInt(row.B25002_001E) || 1;
            const vacant = parseInt(row.B25002_003E) || 0;
            results.push({
              state: row.NAME,
              fips: st.trim(),
              median_home_value: parseInt(row.B25077_001E) || null,
              median_rent: parseInt(row.B25064_001E) || null,
              vacancy_rate: +((vacant / total) * 100).toFixed(1),
              total_units: total
            });
          } catch (e) { continue; }
        }
        return res.status(200).json({
          source: 'US Census Bureau ACS',
          comparison: results,
          year: 2022,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Census compare failed', message: e.message });
      }
    }

    // ─── Yahoo Finance REIT Quotes (Free — no API key needed) ───
    if (source === 'yahoo_quote') {
      try {
        const symbols = (symbol || 'PLD,SPG,O,DLR,CBRE,BXP,JLL,VNO').split(',');
        const quotes = [];
        for (const sym of symbols.slice(0, 10)) {
          try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.trim()}?interval=1d&range=5d`;
            const resp = await fetch(url, {
              headers: { 'User-Agent': 'LandMarq Intelligence Platform' }
            });
            if (!resp.ok) continue;
            const data = await resp.json();
            const result = data.chart?.result?.[0];
            if (!result) continue;
            const meta = result.meta || {};
            const closes = result.indicators?.quote?.[0]?.close || [];
            const lastClose = closes.filter(c => c != null).pop();
            const prevClose = closes.filter(c => c != null).slice(-2, -1)[0];
            quotes.push({
              symbol: sym.trim(),
              price: +(meta.regularMarketPrice || lastClose || 0).toFixed(2),
              previous_close: +(meta.chartPreviousClose || prevClose || 0).toFixed(2),
              change: meta.regularMarketPrice && meta.chartPreviousClose
                ? +(meta.regularMarketPrice - meta.chartPreviousClose).toFixed(2)
                : null,
              change_pct: meta.regularMarketPrice && meta.chartPreviousClose
                ? +(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100).toFixed(2)
                : null,
              currency: meta.currency || 'USD',
              exchange: meta.exchangeName || ''
            });
          } catch (e) { continue; }
        }
        return res.status(200).json({
          source: 'Yahoo Finance',
          quotes: quotes,
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Yahoo Finance fetch failed', message: e.message });
      }
    }

    // ─── FRED Macro Bundle (Bloomberg-style macro dashboard — all free via FRED) ───
    if (source === 'macro') {
      try {
        const fredKey = process.env.FRED_API_KEY || 'DEMO_KEY';
        const macroSeries = [
          { id: 'VIXCLS', label: 'CBOE VIX', category: 'volatility' },
          { id: 'DGS10', label: '10-Year Treasury Yield', category: 'rates' },
          { id: 'DGS2', label: '2-Year Treasury Yield', category: 'rates' },
          { id: 'T10Y2Y', label: '10Y-2Y Spread (Inversion)', category: 'rates' },
          { id: 'BAMLH0A0HYM2', label: 'High Yield Spread', category: 'credit' },
          { id: 'DCOILWTICO', label: 'Crude Oil (WTI)', category: 'commodities' },
          { id: 'DEXUSEU', label: 'USD/EUR Exchange Rate', category: 'forex' },
          { id: 'SP500', label: 'S&P 500', category: 'equities' },
          { id: 'MORTGAGE30US', label: '30-Yr Mortgage Rate', category: 'housing' },
          { id: 'CSUSHPINSA', label: 'Case-Shiller Home Price Index', category: 'housing' },
          { id: 'PERMIT', label: 'Building Permits', category: 'housing' },
          { id: 'UMCSENT', label: 'Consumer Sentiment', category: 'sentiment' },
        ];
        const results = [];
        for (const s of macroSeries) {
          try {
            const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=2`;
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const data = await resp.json();
            const obs = (data.observations || []).filter(o => o.value !== '.');
            if (obs.length >= 1) {
              const cur = parseFloat(obs[0].value);
              const prev = obs.length >= 2 ? parseFloat(obs[1].value) : null;
              results.push({
                id: s.id,
                label: s.label,
                category: s.category,
                value: cur,
                previous: prev,
                change: prev != null ? +(cur - prev).toFixed(4) : null,
                date: obs[0].date
              });
            }
          } catch (e) { continue; }
        }
        return res.status(200).json({
          source: 'FRED Macro Bundle (Bloomberg alternative)',
          indicators: results,
          note: 'VIX, Treasury Yields, Credit Spreads, Oil, Forex, Housing — all via FRED',
          fetched: new Date().toISOString()
        });
      } catch (e) {
        return res.status(500).json({ error: 'Macro bundle failed', message: e.message });
      }
    }

    return res.status(400).json({
      error: 'Unknown source',
      available_sources: [
        'fred', 'edgar', 'bls', 'summary',
        'treasury', 'polymarket', 'kalshi', 'fema', 'earthquake',
        'epa', 'crime', 'hmda', 'walkscore', 'news',
        'reit_quote', 'reit_financials', 'geocode', 'hud_fmr',
        'noaa', 'xbrl', 'vix', 'census', 'census_compare',
        'yahoo_quote', 'macro'
      ]
    });

  } catch (err) {
    console.error('Market data proxy error:', err);
    return res.status(500).json({ error: 'Proxy error', message: err.message });
  }
};
