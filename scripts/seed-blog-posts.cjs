// One-shot seed: insert blog posts into eco-auditor's Postgres.
// Run with: node scripts/seed-blog-posts.cjs
// Must have DATABASE_URL set (run via `railway run` or inside the container).
const { Pool } = require('pg');

const posts = [
  {
    id: 'eco-sb253-compliance-guide-2026',
    slug: 'sb-253-compliance-guide-smb',
    target: 'ecoauditor',
    topic_id: 'sb253-compliance',
    title: 'SB 253 Compliance Guide for SMBs: A Practical Roadmap',
    meta_title: 'SB 253 Compliance Guide for SMBs | Eco-Auditor',
    meta_description: 'A step-by-step SB 253 compliance roadmap for small and mid-sized businesses. Learn reporting thresholds, scope boundaries, and how to build a defensible GHG inventory.',
    primary_keyword: 'SB 253 compliance SMB',
    body_html: `<h2>What SB 253 Means for Small and Mid-Sized Businesses</h2>
<p>California's Climate Corporate Data Accountability Act (SB 253) requires companies with over $1 billion in revenue operating in California to disclose their greenhouse gas (GHG) emissions. While the threshold places the direct reporting burden on large enterprises, the ripple effects reach small and mid-sized businesses (SMBs) throughout their supply chains.</p>
<p>If your SMB supplies goods or services to a covered entity, you will increasingly be asked to provide emissions data as part of their Scope 3 reporting. Getting ahead of this curve means building a defensible GHG inventory now — before it becomes a contract requirement.</p>

<h2>Understanding the Reporting Thresholds</h2>
<p>SB 253 applies a two-phase timeline:</p>
<ul>
<li><strong>Phase 1 (2026):</strong> Companies with revenue over $2 billion report Scope 1 and Scope 2 emissions.</li>
<li><strong>Phase 2 (2027):</strong> All covered companies ($1B+ revenue) report Scope 1, 2, and begin Scope 3.</li>
<li><strong>Phase 3 (2028+):</strong> Full Scope 3 reporting with third-party assurance.</li>
</ul>
<p>As an SMB, you are not directly covered by these thresholds. But your largest customers are. They need your emissions data to complete their own disclosures — and they will ask for it through procurement surveys, supplier portals, and ESG questionnaires.</p>

<h2>Building a Defensible GHG Inventory</h2>
<p>A defensible GHG inventory is one that can withstand external scrutiny — from auditors, customers, and regulators. The GHG Protocol Corporate Standard provides the accounting framework:</p>
<ol>
<li><strong>Define organizational and operational boundaries.</strong> Decide which facilities, vehicles, and activities are included. Use either the equity share or control approach.</li>
<li><strong>Collect activity data.</strong> Gather utility bills, fuel receipts, purchase records, and freight manifests. The more granular, the better.</li>
<li><strong>Apply emission factors.</strong> Convert activity data (therms, kWh, gallons, dollars) into CO2e using published factors from EPA, eGRID, and DEFRA.</li>
<li><strong>Document your methodology.</strong> Record which factors you used, where data came from, and any assumptions. This is what auditors check.</li>
</ol>

<h2>Scope 3: The Supply Chain Challenge</h2>
<p>Scope 3 emissions — those in your value chain — typically account for 70-90% of a company's total carbon footprint. For SMBs, the most relevant Scope 3 categories are:</p>
<ul>
<li><strong>Category 1: Purchased goods and services</strong> — The emissions embedded in everything you buy, from raw materials to office supplies.</li>
<li><strong>Category 4: Upstream transportation</strong> — Freight, shipping, and logistics.</li>
<li><strong>Category 11: Use of sold products</strong> — If your products consume energy during their lifetime.</li>
</ul>
<p>Start with a spend-based approach for Category 1: multiply purchase dollar amounts by industry-average emission factors. It is less precise than supplier-specific data, but it is defensible and scalable.</p>

<h2>How Eco-Auditor Helps</h2>
<p>Eco-Auditor automates the heavy lifting of GHG accounting for SMBs:</p>
<ul>
<li><strong>Emission factor library:</strong> Pre-loaded with EPA, eGRID, DEFRA, and GHG Protocol factors, updated quarterly.</li>
<li><strong>Scope 1, 2, and 3 calculations:</strong> Built-in formulas for stationary combustion, purchased electricity, purchased goods, and freight.</li>
<li><strong>SB 253-ready reports:</strong> Export disclosures in the format your customers' auditors expect.</li>
<li><strong>Supply chain surveys:</strong> Send a single link to your suppliers and auto-calculate their contribution to your Scope 3.</li>
</ul>

<h2>Key Takeaways</h2>
<ul>
<li>SB 253 does not directly regulate SMBs, but supply chain pressure makes compliance unavoidable.</li>
<li>Start with Scope 1 and 2 — they are the easiest to measure and the first thing customers ask about.</li>
<li>Use spend-based methods for Scope 3 until you can collect supplier-specific data.</li>
<li>Document everything — a defensible methodology is worth more than precise numbers.</li>
</ul>`,
    faq: [
      { question: 'Does SB 253 apply to small businesses?', answer: 'SB 253 directly applies to companies with over $1 billion in revenue operating in California. However, SMBs in the supply chains of covered companies will be asked to provide emissions data as part of Scope 3 reporting requirements.' },
      { question: 'What is the deadline for SB 253 reporting?', answer: 'Phase 1 reporting (Scope 1 and 2 for companies over $2B revenue) begins in 2026. Full Scope 3 reporting with third-party assurance is required by 2028.' },
      { question: 'How do I calculate Scope 3 emissions as an SMB?', answer: 'Start with a spend-based approach: multiply purchase dollar amounts by industry-average emission factors. This provides a defensible estimate without requiring supplier-specific data. Refine over time by collecting primary data from your largest suppliers.' },
      { question: 'What emission factors should I use?', answer: 'Use EPA Center for Corporate Climate Leadership factors for US operations, eGRID for electricity, and DEFRA for international activities. Eco-Auditor includes all of these in its pre-loaded factor library, updated quarterly.' },
    ],
    internal_links: [
      { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
      { href: 'https://ecoauditor.io/methodology', anchor: 'GHG methodology' },
    ],
    external_links: [
      { href: 'https://ghgprotocol.org/corporate-standard', anchor: 'GHG Protocol Corporate Standard' },
      { href: 'https://ww2.arb.ca.gov/our-work/programs/climate-corporate-data-accountability', anchor: 'CARB SB 253 program page' },
    ],
    cta: { label: 'Start your free trial', href: '/signup' },
    content_score: 82,
    geo_score: 74,
  },
  {
    id: 'eco-ghg-protocol-scope3-smb',
    slug: 'ghg-protocol-scope-3-guide-smb',
    target: 'ecoauditor',
    topic_id: 'ghg-scope3-smb',
    title: 'GHG Protocol Scope 3 for SMBs: Where to Start and What to Measure',
    meta_title: 'GHG Protocol Scope 3 Guide for SMBs | Eco-Auditor',
    meta_description: 'A practical guide to GHG Protocol Scope 3 emissions for small and mid-sized businesses. Learn which categories matter, how to measure them, and how to build a defensible inventory.',
    primary_keyword: 'GHG Protocol Scope 3 SMB',
    body_html: `<h2>Why Scope 3 Matters for SMBs</h2>
<p>Scope 3 emissions — the indirect emissions in your value chain — typically represent 70-90% of a company's total carbon footprint. For small and mid-sized businesses, Scope 3 can feel overwhelming because it encompasses everything from purchased goods to employee commuting. But ignoring it is no longer an option.</p>
<p>Your enterprise customers need your emissions data to complete their own Scope 3 disclosures. Regulators like California's CARB are tightening reporting requirements. And investors increasingly factor carbon exposure into risk assessments. The good news: you do not need to measure all 15 Scope 3 categories to be defensible. You need to measure the ones that matter.</p>

<h2>The 15 Scope 3 Categories — Ranked for SMBs</h2>
<p>The GHG Protocol defines 15 Scope 3 categories. For most SMBs, only a handful are material:</p>
<h3>High priority (measure first)</h3>
<ul>
<li><strong>Category 1 — Purchased goods and services:</strong> The emissions embedded in everything you buy. Usually the largest Scope 3 category for product-based businesses.</li>
<li><strong>Category 4 — Upstream transportation and distribution:</strong> Freight, shipping, and logistics emissions from moving your inputs.</li>
<li><strong>Category 11 — Use of sold products:</strong> If your products consume energy during use, this can dwarf everything else.</li>
</ul>
<h3>Medium priority (estimate when feasible)</h3>
<ul>
<li><strong>Category 5 — Waste generated in operations:</strong> Use waste contractor data or estimate by waste type and volume.</li>
<li><strong>Category 6 — Business travel:</strong> Flight and hotel data from expense systems.</li>
<li><strong>Category 7 — Employee commuting:</strong> Survey-based or estimated by office size and region.</li>
</ul>
<h3>Low priority (screen and skip if immaterial)</h3>
<ul>
<li><strong>Categories 2, 3, 8, 9, 10, 12, 13, 14, 15:</strong> For most SMBs, these are either zero, negligible, or not applicable. Document that you screened them and explain why they are immaterial.</li>
</ul>

<h2>How to Measure Scope 3 Without a Sustainability Team</h2>
<p>You do not need a dedicated sustainability team to build a credible Scope 3 inventory. Here is the practical path:</p>
<ol>
<li><strong>Start with spend data.</strong> Export your accounts payable ledger and categorize purchases by industry sector. Multiply each category by an EPA or DEFRA spend-based emission factor. This gives you a defensible Category 1 estimate in hours, not weeks.</li>
<li><strong>Pull freight records.</strong> Your shipping invoices contain mode (truck, rail, air), distance, and weight. Apply the EPA SmartWay factors to estimate Category 4.</li>
<li><strong>Estimate product use.</strong> If you sell physical products that consume energy, estimate lifetime energy consumption and multiply by the grid emission factor for your primary market.</li>
<li><strong>Document what you skipped and why.</strong> A screening explanation for the categories you did not measure is itself part of a defensible inventory. Auditors want to see that you assessed relevance, not that you measured everything.</li>
</ol>

<h2>Building a Defensible Methodology</h2>
<p>Defensibility means your numbers can survive external review. Three principles:</p>
<ul>
<li><strong>Traceability:</strong> Every number should link back to a source document — a utility bill, a purchase order, a freight manifest.</li>
<li><strong>Consistency:</strong> Use the same emission factors and boundary definitions year over year. Changes require restatement and disclosure.</li>
<li><strong>Transparency:</strong> Document your assumptions, exclusions, and estimation methods. A clear methodology disclosure is worth more than a precise number with no paper trail.</li>
</ul>

<h2>How Eco-Auditor Simplifies Scope 3</h2>
<p>Eco-Auditor is built specifically for SMBs navigating Scope 3 for the first time:</p>
<ul>
<li><strong>Spend-based Category 1 calculator:</strong> Upload your AP ledger and get instant CO2e estimates by purchase category.</li>
<li><strong>Freight emission estimator:</strong> Enter mode, distance, and weight to get Category 4 emissions.</li>
<li><strong>Pre-loaded emission factors:</strong> EPA, eGRID, DEFRA, and GHG Protocol factors — updated quarterly, sourced transparently.</li>
<li><strong>Scope 3 screening template:</strong> Document which categories you assessed, which you measured, and which you excluded — with one-click rationale.</li>
<li><strong>Customer-ready exports:</strong> Generate reports in the format your enterprise customers' auditors expect.</li>
</ul>

<h2>Key Takeaways</h2>
<ul>
<li>You do not need to measure all 15 Scope 3 categories. Focus on the 3-5 that are material to your business.</li>
<li>Spend-based methods are defensible for Category 1 — refine with supplier-specific data over time.</li>
<li>Documentation and screening explanations are part of a defensible inventory, not optional extras.</li>
<li>Start now. Your enterprise customers are already asking for this data, and the requests will only increase.</li>
</ul>`,
    faq: [
      { question: 'Which Scope 3 categories should an SMB measure first?', answer: 'Start with Category 1 (purchased goods and services), Category 4 (upstream transportation), and Category 11 (use of sold products). These typically represent the largest share of Scope 3 emissions for SMBs and can be estimated using spend-based methods.' },
      { question: 'Is spend-based Scope 3 reporting defensible?', answer: 'Yes. The GHG Protocol explicitly accepts spend-based methods as a valid estimation approach for Scope 3 Category 1. Document your data sources, emission factors, and assumptions. Refine with supplier-specific data over time.' },
      { question: 'How do I screen Scope 3 categories I decide not to measure?', answer: 'Document which categories you assessed, why they are immaterial (zero activity, negligible volume, not applicable), and keep this screening explanation as part of your inventory. This is standard GHG Protocol practice and expected by auditors.' },
      { question: 'Do I need third-party assurance for Scope 3?', answer: 'Under SB 253, third-party assurance for Scope 3 is required starting in 2028 for covered companies. SMBs supplying to covered companies should prepare for assurance-level data quality, but are not directly subject to the assurance requirement themselves.' },
    ],
    internal_links: [
      { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
      { href: 'https://ecoauditor.io/pricing', anchor: 'Eco-Auditor pricing' },
    ],
    external_links: [
      { href: 'https://ghgprotocol.org/corporate-value-chain-scope-3-standard', anchor: 'GHG Protocol Scope 3 Standard' },
      { href: 'https://www.epa.gov/climateleadership/scope-3-inventory-guidance', anchor: 'EPA Scope 3 guidance' },
    ],
    cta: { label: 'Start your free trial', href: '/signup' },
    content_score: 84,
    geo_score: 76,
  },
  {
    id: 'eco-carbon-accounting-software-smb',
    slug: 'carbon-accounting-software-smb-guide',
    target: 'ecoauditor',
    topic_id: 'carbon-accounting-smb',
    title: 'Carbon Accounting Software for SMBs: What to Look For in 2026',
    meta_title: 'Carbon Accounting Software for SMBs (2026 Guide) | Eco-Auditor',
    meta_description: 'A buyer\'s guide to carbon accounting software for small and mid-sized businesses. Compare features, pricing models, and must-have capabilities for 2026 compliance.',
    primary_keyword: 'carbon accounting software SMB',
    body_html: `<h2>Why SMBs Need Carbon Accounting Software Now</h2>
<p>Carbon accounting used to be a spreadsheet exercise managed by an external consultant once a year. In 2026, that approach no longer holds up. Regulatory pressure from SB 253, CBAM, and SEC climate disclosure rules means emissions data needs to be audit-ready, continuously updated, and defensible — not a static PDF that took three months to produce.</p>
<p>For SMBs, the challenge is finding software that fits your budget and team size without sacrificing the rigor that enterprise customers and regulators expect. Here is what to look for.</p>

<h2>Must-Have Features for SMB Carbon Accounting</h2>
<h3>1. Pre-loaded emission factor libraries</h3>
<p>Your software should ship with emission factors from EPA, eGRID, DEFRA, and the GHG Protocol — not require you to research and input them manually. Factors should be versioned, sourced, and updated at least quarterly to reflect grid changes and methodology refinements.</p>
<h3>2. Scope 1, 2, and 3 support</h3>
<p>Many tools handle Scope 1 and 2 well but treat Scope 3 as an afterthought. For SMBs in supply chains of regulated companies, Scope 3 is where the scrutiny is. Look for spend-based Category 1 calculation, freight estimation, and a screening template for the categories you do not measure.</p>
<h3>3. Audit-ready documentation</h3>
<p>Every calculation should be traceable to its source data and emission factor. Look for audit trails that record who entered data, when it was modified, and which factors were applied. This is what third-party assurance providers check first.</p>
<h3>4. Customer-ready reporting</h3>
<p>Can the tool export reports in the formats your enterprise customers request? CDP, GRI, TCFD, and custom supplier questionnaire formats should all be supported. If you are manually reformatting reports for each customer, the tool is not doing its job.</p>
<h3>5. Supply chain survey tools</h3>
<p>The best way to improve Scope 3 data quality is to collect primary data from your suppliers. Look for tools that let you send a single survey link to suppliers and automatically calculate their contribution to your inventory.</p>

<h2>Pricing Models: What Makes Sense for SMBs</h2>
<p>Carbon accounting tools typically price in one of three ways:</p>
<ul>
<li><strong>Per-facility pricing:</strong> Charged based on the number of facilities or sites. Works for businesses with few locations but gets expensive fast for distributed operations.</li>
<li><strong>Per-user pricing:</strong> Charged per seat. Best for teams where only a few people need access. Look for tools that allow read-only viewers at no extra cost.</li>
<li><strong>Tiered plans:</strong> Fixed monthly or annual price with feature gates. Best for SMBs — predictable cost, no surprises as you add facilities or data.</li>
</ul>
<p>Eco-Auditor uses tiered pricing (Starter, Growth, Pro) with no per-facility or per-user penalties. You get the full feature set at every tier, with differences in data volume and API access.</p>

<h2>Red Flags to Watch For</h2>
<ul>
<li><strong>"AI-generated" emission estimates with no methodology:</strong> If a tool gives you a carbon number without showing the underlying factors and calculations, it is not defensible. Auditors will reject it.</li>
<li><strong>No Scope 3 support:</strong> Tools that only cover Scope 1 and 2 leave you unprepared for the supply chain reporting requests that are already arriving.</li>
<li><strong>Annual-only updates:</strong> Emission factors change as grids decarbonize and methodologies evolve. If your tool updates factors once a year, your numbers are stale within months.</li>
<li><strong>No data export:</strong> If you cannot export your raw data and calculations, you are locked in. Your inventory should be portable.</li>
</ul>

<h2>The Spreadsheet Question</h2>
<p>Many SMBs start with Excel. That is fine for a first-pass estimate, but spreadsheets break down fast:</p>
<ul>
<li>No version control on emission factors — different team members use different versions.</li>
<li>No audit trail — impossible to trace who changed what and when.</li>
<li>No validation — formula errors propagate silently.</li>
<li>No emission factor updates — you are manually maintaining a database that should be managed by experts.</li>
</ul>
<p>If you are spending more than two hours a month maintaining a carbon spreadsheet, dedicated software will pay for itself in time saved and errors prevented.</p>

<h2>How Eco-Auditor Compares</h2>
<p>Eco-Auditor was built specifically for SMBs — not as a stripped-down enterprise tool:</p>
<ul>
<li><strong>Pre-loaded factors:</strong> EPA, eGRID, DEFRA, GHG Protocol — updated quarterly, fully sourced.</li>
<li><strong>All three scopes:</strong> Scope 1, 2, and 3 with spend-based methods and screening templates.</li>
<li><strong>Audit-ready:</strong> Every calculation links to source data, factor version, and methodology.</li>
<li><strong>Customer-ready exports:</strong> CDP, GRI, TCFD, and custom formats.</li>
<li><strong>Supply chain surveys:</strong> Send one link, auto-calculate supplier contributions.</li>
<li><strong>Tiered pricing:</strong> Starter at $49/month, no per-facility or per-user penalties.</li>
</ul>

<h2>Key Takeaways</h2>
<ul>
<li>Carbon accounting software is no longer optional for SMBs in regulated supply chains — enterprise customers and regulators demand audit-ready data.</li>
<li>Look for pre-loaded emission factors, full Scope 3 support, audit trails, and customer-ready reporting.</li>
<li>Avoid tools with opaque "AI" estimates, no Scope 3, or no data export.</li>
<li>Tiered pricing without per-facility or per-user penalties is the SMB-friendly model.</li>
</ul>`,
    faq: [
      { question: 'How much does carbon accounting software cost for an SMB?', answer: 'Carbon accounting software for SMBs typically ranges from $49 to $500 per month depending on features and data volume. Eco-Auditor offers tiered plans starting at $49/month (Starter) with no per-facility or per-user penalties.' },
      { question: 'Can I use Excel for carbon accounting?', answer: 'Excel works for a first-pass estimate but breaks down quickly due to lack of version control, audit trails, emission factor updates, and validation. If you spend more than two hours a month maintaining a carbon spreadsheet, dedicated software will save time and reduce errors.' },
      { question: 'What emission factors should carbon accounting software include?', answer: 'Look for EPA Center for Corporate Climate Leadership factors, eGRID for electricity, DEFRA for international activities, and GHG Protocol guidance. Factors should be versioned, sourced, and updated at least quarterly.' },
      { question: 'Do SMBs need Scope 3 reporting software?', answer: 'Yes. Even if SMBs are not directly regulated by SB 253 or CBAM, enterprise customers in their supply chains require Scope 3 data. Look for software with spend-based Category 1 calculation and screening templates for immaterial categories.' },
    ],
    internal_links: [
      { href: 'https://ecoauditor.io/pricing', anchor: 'Eco-Auditor pricing' },
      { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
      { href: 'https://ecoauditor.io/demo', anchor: 'Book a demo' },
    ],
    external_links: [
      { href: 'https://ghgprotocol.org/', anchor: 'GHG Protocol' },
      { href: 'https://www.epa.gov/climateleadership', anchor: 'EPA Climate Leadership' },
    ],
    cta: { label: 'Start your free trial', href: '/signup' },
    content_score: 80,
    geo_score: 72,
  },
  {
    id: 'eco-cbam-supply-chain-smb',
    slug: 'cbam-supply-chain-guide-smb',
    target: 'ecoauditor',
    topic_id: 'cbam-smb',
    title: 'CBAM and Supply Chain Emissions: What SMBs Need to Know',
    meta_title: 'CBAM Supply Chain Emissions Guide for SMBs | Eco-Auditor',
    meta_description: 'How the EU Carbon Border Adjustment Mechanism affects SMBs in US supply chains. Learn CBAM reporting requirements, embedded emissions, and how to prepare.',
    primary_keyword: 'CBAM supply chain emissions SMB',
    body_html: `<h2>What Is CBAM and Why Should SMBs Care?</h2>
<p>The EU Carbon Border Adjustment Mechanism (CBAM) is a carbon tariff on imported goods entering the European Union. It targets carbon-intensive sectors — iron and steel, aluminum, cement, fertilizers, electricity, and hydrogen — and requires importers to report the embedded emissions of their products.</p>
<p>If your SMB manufactures, processes, or supplies goods in any CBAM sector, you are in scope — even if you never directly import into the EU. Your EU-based customers need your emissions data to comply with CBAM reporting obligations, and they will ask you for it.</p>

<h2>CBAM Timeline: What Is Happening and When</h2>
<ul>
<li><strong>2023-2025 (Transitional period):</strong> Importers must report embedded emissions quarterly. No financial obligation yet, but reporting is mandatory.</li>
<li><strong>2026 (Definitive period begins):</strong> CBAM certificates must be purchased for embedded emissions. Financial liability starts.</li>
<li><strong>2026-2034:</strong> Phase-out of free EU ETS allowances, increasing the effective CBAM cost per tonne of CO2e.</li>
</ul>
<p>For SMBs, the transitional period is the window to get your emissions data in order. By 2026, your EU customers will need verified embedded emissions numbers — not estimates.</p>

<h2>Understanding Embedded Emissions</h2>
<p>CBAM focuses on "embedded emissions" — the direct emissions from producing a good, plus the emissions from electricity consumed in production. For SMBs, this means:</p>
<ul>
<li><strong>Scope 1 (direct):</strong> Combustion from your furnaces, boilers, and vehicles used in production.</li>
<li><strong>Scope 2 (electricity):</strong> Grid electricity consumed in manufacturing processes.</li>
<li><strong>Not included (for CBAM purposes):</strong> Upstream Scope 3 emissions from purchased goods, transportation, or waste. CBAM's boundary is narrower than a full GHG inventory.</li>
</ul>
<p>This is actually simpler than full GHG accounting. CBAM asks: what came out of your stack and what electricity did you use to make this specific product?</p>

<h2>How to Calculate Embedded Emissions for CBAM</h2>
<ol>
<li><strong>Identify CBAM goods.</strong> Determine which of your products fall under the six CBAM sectors. HS codes and product descriptions determine coverage.</li>
<li><strong>Allocate emissions to products.</strong> If you produce multiple products, you need a rational allocation method — mass-based, economic, or physical-unit-based. Document your choice.</li>
<li><strong>Calculate specific embedded emissions (SEE).</strong> Total direct + electricity emissions divided by production volume. Express as tCO2e per tonne of product.</li>
<li><strong>Document your installation boundary.</strong> Map which processes, equipment, and facilities contribute to the CBAM good's production. Auditors verify this boundary.</li>
</ol>

<h2>What Your EU Customers Will Ask For</h2>
<p>EU importers need to submit CBAM reports quarterly. To do so, they need from you:</p>
<ul>
<li>The total quantity of goods imported (in tonnes)</li>
<li>The specific embedded emissions per tonne</li>
<li>The production installation's name, address, and country</li>
<li>The emission factor for electricity used in production</li>
<li>A description of the production process and system boundary</li>
</ul>
<p>If you cannot provide this data, your EU customer must use default values (which are deliberately set high to encourage actual reporting). This makes your product less competitive — the default CBAM cost is always worse than your real number.</p>

<h2>How to Prepare as an SMB</h2>
<ol>
<li><strong>Audit your product portfolio.</strong> Identify any products in CBAM sectors (iron/steel, aluminum, cement, fertilizers, electricity, hydrogen). Check HS codes.</li>
<li><strong>Map your installation boundary.</strong> Document which processes and equipment produce CBAM goods. Separate them from non-CBAM production if possible.</li>
<li><strong>Start tracking production-specific energy use.</strong> Sub-meter electricity and fuel use for CBAM production lines. Without sub-metering, you must allocate total facility emissions — less precise and harder to defend.</li>
<li><strong>Calculate your SEE now.</strong> Even a rough estimate tells you whether CBAM will be a material cost. Use last year's production data and current emission factors.</li>
<li><strong>Prepare a CBAM data pack.</strong> Create a standard report you can send to any EU customer: product, quantity, SEE, installation details, electricity emission factor, methodology.</li>
</ol>

<h2>How Eco-Auditor Helps with CBAM</h2>
<ul>
<li><strong>Product-level emission allocation:</strong> Allocate facility emissions to specific products using mass-based or economic methods.</li>
<li><strong>Sub-metering support:</strong> Track electricity and fuel use by production line, not just by facility.</li>
<li><strong>CBAM data pack export:</strong> Generate a standard CBAM report with installation details, SEE, electricity factors, and methodology documentation.</li>
<li><strong>EU grid emission factors:</strong> Pre-loaded with EU Member State grid factors for accurate electricity accounting.</li>
</ul>

<h2>Key Takeaways</h2>
<ul>
<li>CBAM affects SMBs that produce or supply goods in six carbon-intensive sectors — even if they never directly import into the EU.</li>
<li>CBAM's boundary is narrower than full GHG accounting: direct production emissions plus electricity, allocated to specific products.</li>
<li>Your EU customers need verified embedded emissions data. Without it, they must use punitive default values that make your product less competitive.</li>
<li>Start calculating your specific embedded emissions now — the 2026 financial obligation is coming, and preparation takes months, not weeks.</li>
</ul>`,
    faq: [
      { question: 'Does CBAM apply to small businesses?', answer: 'CBAM applies to importers of covered goods into the EU. While SMBs may not be direct importers, SMBs that supply goods in CBAM sectors (iron/steel, aluminum, cement, fertilizers, electricity, hydrogen) to EU-based customers must provide embedded emissions data for those customers to comply.' },
      { question: 'What is the difference between CBAM embedded emissions and Scope 3 emissions?', answer: 'CBAM embedded emissions include only direct production emissions (Scope 1) and electricity consumption (Scope 2) allocated to a specific product. Scope 3 includes all value chain emissions. CBAM\'s boundary is narrower and product-specific.' },
      { question: 'When does CBAM start charging for emissions?', answer: 'The transitional period (reporting only) runs from 2023 to 2025. The definitive period with financial obligations begins in 2026, when importers must purchase CBAM certificates for embedded emissions.' },
      { question: 'How are embedded emissions allocated to products?', answer: 'Use mass-based allocation (emissions divided by product weight), economic allocation (by revenue share), or physical-unit allocation. Document your chosen method and apply it consistently. Sub-metering production lines improves precision.' },
    ],
    internal_links: [
      { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
      { href: 'https://ecoauditor.io/methodology', anchor: 'GHG methodology' },
    ],
    external_links: [
      { href: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en', anchor: 'EU CBAM official page' },
      { href: 'https://ghgprotocol.org/corporate-standard', anchor: 'GHG Protocol Corporate Standard' },
    ],
    cta: { label: 'Start your free trial', href: '/signup' },
    content_score: 81,
    geo_score: 73,
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,
        target      TEXT NOT NULL,
        topic_id    TEXT NOT NULL,
        title       TEXT NOT NULL,
        meta_title  TEXT NOT NULL,
        meta_description TEXT NOT NULL,
        body_html   TEXT NOT NULL,
        primary_keyword TEXT NOT NULL,
        faq         JSONB NOT NULL DEFAULT '[]'::jsonb,
        internal_links JSONB NOT NULL DEFAULT '[]'::jsonb,
        external_links JSONB NOT NULL DEFAULT '[]'::jsonb,
        cta         JSONB NOT NULL,
        content_score INT,
        geo_score   INT,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS blog_posts_target_idx ON blog_posts(target);
      CREATE INDEX IF NOT EXISTS blog_posts_published_at_idx ON blog_posts(published_at DESC);
    `);
    console.log('Table ensured.');

    let inserted = 0;
    let skipped = 0;
    for (const post of posts) {
      try {
        await pool.query(
          `INSERT INTO blog_posts (id, slug, target, topic_id, title, meta_title, meta_description, body_html, primary_keyword, faq, internal_links, external_links, cta, content_score, geo_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (slug) DO NOTHING`,
          [
            post.id, post.slug, post.target, post.topic_id, post.title,
            post.meta_title, post.meta_description, post.body_html, post.primary_keyword,
            JSON.stringify(post.faq), JSON.stringify(post.internal_links),
            JSON.stringify(post.external_links), JSON.stringify(post.cta),
            post.content_score, post.geo_score
          ]
        );
        inserted++;
      } catch (err) {
        console.error(`Failed to insert ${post.slug}:`, err.message);
        skipped++;
      }
    }
    console.log(`Inserted: ${inserted}, Skipped: ${skipped}`);

    const { rows } = await pool.query('SELECT slug, title, published_at FROM blog_posts ORDER BY published_at DESC');
    console.log('Current posts:');
    for (const r of rows) {
      console.log(`  ${r.slug} — ${r.title} (${r.published_at.toISOString()})`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();