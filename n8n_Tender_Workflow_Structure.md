# n8n Tender Automation Workflow: Architecture & Node Structure

This document outlines the exact node structure you need to build in n8n to automate the scraping of tender portals, reading PDFs with AI, and pushing the summaries to your Notion database.

---

## The Workflow Blueprint

### Phase 1: Trigger & Data Ingestion (The "Antennas")
You need to pull data from multiple sources. Instead of building complex scraper bots that get blocked, we use RSS feeds or API aggregators where possible, and simple HTTP scrapers where necessary.

**1. Schedule Trigger Node**
*   **Node Type:** `Schedule Trigger`
*   **Configuration:** Set to run every 6 hours (e.g., at 6:00 AM, 12:00 PM, 6:00 PM, 12:00 AM) to ensure you beat competitors to new listings.

**2. HTTP Request Nodes (Parallel Data Pulls)**
Create multiple HTTP Request nodes branching off the trigger.
*   **Node A (AusTender RSS):**
    *   **Method:** GET
    *   **URL:** `https://www.tenders.gov.au/rss/atm` (or equivalent category feed)
    *   **Response Format:** JSON/XML (Use the `XML` parser node if needed).
*   **Node B (NSW eTendering RSS / Apify Scraper):**
    *   **Method:** GET
    *   **URL:** The URL of an Apify actor you setup to scrape NSW tenders, or the direct state RSS feed.
    *   **Authentication:** Add API keys if using Apify or a paid aggregator like TenderSearch.

**3. Merge Node**
*   **Node Type:** `Merge`
*   **Configuration:** Mode set to `Append`. This combines the lists of tenders from all your different HTTP Request nodes into one massive list of items.

---

### Phase 2: Filtering & Downloading

**4. Filter Node**
*   **Node Type:** `Filter`
*   **Condition:** Keep item if `String` -> `Title` or `Description` -> `contains` -> "cleaning" OR "security" OR "facility".
*   *Why?* This immediately drops irrelevant tenders (like IT software or construction contracts) so you don't waste API credits processing them.

**5. HTTP Request Node (PDF Downloader)**
*   **Node Type:** `HTTP Request`
*   **Method:** GET
*   **URL:** `{{ $json.document_url }}` (Dynamic link from the tender item)
*   **Response Format:** `File`
*   **Output Property Name:** `data` (This downloads the 100-page PDF into n8n's memory).

**6. PDF Extractor Node**
*   **Node Type:** `Extract from File` (n8n built-in) or an `HTTP Request` to an API like **LlamaParse**.
*   **Configuration:** If the PDFs are mostly text, the built-in extractor works. If they have complex tables, route the file to LlamaParse via HTTP Request to get clean Markdown text back.

---

### Phase 3: The LLM Chain (AI Analysis)

**7. Basic LLM Chain Node**
*   **Node Type:** `Basic LLM Chain` (from the Advanced AI section in n8n).
*   **Connected Model Node:** Drag an `OpenAI Chat Model` (e.g., gpt-4o) or `Google Gemini Model` into the Model input of the chain.
*   **Prompt Configuration:**
    *   *System Message:* "You are an expert bid analyst for Chief Group Services, a top-tier security and cleaning firm. Your job is to extract critical information from government tender documents."
    *   *Prompt:* 
    ```text
    Read the following tender text and extract the details.
    
    Tender Text: {{ $json.extracted_text }}
    
    Output exactly this format:
    **Summary:** [1 paragraph summary of the job]
    **Budget/Value:** [Extracted budget or 'Not Listed']
    **Deadlines:** [Submission closing date and time]
    **Go/No-Go Red Flags:** [List any mandatory ISO certifications, union requirements, or minimum insurance thresholds. If none, write 'None found'.]
    ```

---

### Phase 4: Delivery to Notion

**8. Notion Node**
*   **Node Type:** `Notion`
*   **Resource:** `Database Page`
*   **Operation:** `Create`
*   **Database ID:** Select your Target Notion Database (you will need to authenticate your Notion account in n8n credentials).
*   **Property Mapping (Map the outputs from the LLM and the HTTP nodes):**
    *   `Name / Title`: `{{ $node["Filter"].json.tender_title }}`
    *   `Source URL`: `{{ $node["Filter"].json.tender_url }}`
    *   `Closing Date`: `{{ $node["LLM Chain"].json.Deadlines }}`
    *   `AI Summary & Red Flags`: `{{ $node["LLM Chain"].json.text }}` (Map the entire response to a rich text or summary column).
    *   `Status`: Set default to "Needs Review".

### How to Build This Now:
1. Open your n8n workspace.
2. Start by adding a **Schedule Trigger**.
3. Add the **HTTP Request** node to pull a single RSS feed (like AusTender) first to test the data structure.
4. Once you see the data flowing, add the **OpenAI / LLM node** to process it, and finally link your **Notion API key** to create the pages.
