#!/usr/bin/env python3
"""Tektronix documentation scraper v2 — uses real sitemap-discovered URLs."""

import json
import os
import re
import time
import hashlib
import html
import sys
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, NavigableString

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
})

DELAY = 1.0
MIN_WORDS = 150
MAX_WORDS = 800
CORPUS = "tek_docs"

all_chunks = []
seen_ids = set()
failed_urls = []
success_urls = []


def fetch(url, retries=1):
    for attempt in range(retries + 1):
        try:
            time.sleep(DELAY)
            r = SESSION.get(url, timeout=15, allow_redirects=True)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.text
        except Exception as e:
            if attempt == retries:
                return None
            time.sleep(2)
    return None


def slugify(text, maxlen=60):
    text = text.lower().strip()
    text = re.sub(r'[^a-z0-9\s]', '', text)
    text = re.sub(r'\s+', '_', text)
    return text[:maxlen].rstrip('_')


def clean_text(raw):
    text = html.unescape(raw)
    text = re.sub(r'\s+', ' ', text).strip()
    # Remove boilerplate
    boilerplate_patterns = [
        r'Contact us\s+Request Services[^.]*',
        r'Download Manuals[^.]*',
        r'Request a Quote[^.]*',
        r'Cookie\s+(?:preferences|settings)[^.]*',
        r'Skip to main content',
        r'Back to top',
        r'Share this article[^.]*',
        r'Subscribe to our newsletter[^.]*',
        r'Get the latest[^.]*newsletter[^.]*',
    ]
    for bp in boilerplate_patterns:
        text = re.sub(bp, '', text, flags=re.IGNORECASE)
    return text.strip()


def word_count(text):
    return len(text.split())


def extract_main_content(soup):
    """Find the main content area."""
    # Remove unwanted elements first
    for tag in soup.select('nav, footer, header, .sidebar, .cookie-banner, script, style, .breadcrumb, .social-share, .related-products, .cta-banner, form, .modal, .chat-widget, #onetrust-consent-sdk, .menu, .toolbar, .tabs-nav, .pager, noscript, iframe'):
        tag.decompose()
    
    selectors = [
        'article .field--type-text-with-summary',
        'article .field--type-text-long',
        '.node__content .field--type-text-with-summary',
        '.node__content .field--type-text-long',
        'article',
        'main .content',
        'main',
        '.page-content',
        '.node__content',
        '#block-tektronix-content',
        '.layout-content',
        '[role="main"]',
    ]
    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            text = el.get_text(' ', strip=True)
            if word_count(text) >= 50:
                return el
    return soup.body if soup.body else soup


def split_by_headings(content_el):
    """Split content by h2/h3 headings into sections."""
    sections = []
    current_heading = None
    current_parts = []

    for child in content_el.children:
        if hasattr(child, 'name') and child.name in ('h2', 'h3', 'h4'):
            if current_parts:
                text = clean_text(' '.join(current_parts))
                if word_count(text) >= 30:
                    sections.append((current_heading, text))
            current_heading = clean_text(child.get_text())
            current_parts = []
        else:
            if hasattr(child, 'get_text'):
                t = child.get_text(' ', strip=True)
                if t:
                    current_parts.append(t)
            elif isinstance(child, NavigableString):
                t = str(child).strip()
                if t:
                    current_parts.append(t)

    if current_parts:
        text = clean_text(' '.join(current_parts))
        if word_count(text) >= 30:
            sections.append((current_heading, text))

    return sections


def chunk_text(text, max_words=MAX_WORDS):
    words = text.split()
    if len(words) <= max_words:
        return [text]

    chunks = []
    sentences = re.split(r'(?<=[.!?])\s+', text)
    current = []
    current_wc = 0

    for sent in sentences:
        swc = len(sent.split())
        if current_wc + swc > max_words and current_wc >= MIN_WORDS:
            chunks.append(' '.join(current))
            current = [sent]
            current_wc = swc
        else:
            current.append(sent)
            current_wc += swc

    if current:
        last = ' '.join(current)
        if word_count(last) < MIN_WORDS and chunks:
            chunks[-1] += ' ' + last
        else:
            chunks.append(last)

    return chunks


def extract_tags(title, body):
    # Content-type tags are derived from the TITLE only (not body).
    # Body text can contain words like "FAQ" in sidebar nav/links — using only
    # the title (which the scraper prefixes with the category, e.g. "FAQ: ...")
    # gives reliable, URL-driven content-type classification.
    title_upper = title.upper()
    combined = (title + ' ' + body).upper()

    model_tags = set()
    models = [
        'MSO2', 'MSO3', 'MSO4', 'MSO5', 'MSO6', 'MSO44', 'MSO46', 'MSO54', 'MSO56', 'MSO58', 'MSO64',
        'MSO6B', 'MSO4B', 'MSO5B',
        'DPO7000', 'DPO70000', 'DPO4000', 'DPO5000', 'DPO70000SX',
        'MDO3000', 'MDO4000',
        'TBS1000', 'TBS2000',
        '2 SERIES MSO', '3 SERIES MDO', '4 SERIES MSO', '5 SERIES MSO', '6 SERIES MSO', '7 SERIES DPO',
        '4 SERIES B MSO', '5 SERIES B MSO', '6 SERIES B MSO',
    ]
    for m in models:
        if m in combined:
            model_tags.add(m.replace(' ', '_'))

    topic_tags = set()
    topics = {
        'TRIGGER': 'trigger', 'PROBE': 'probe', 'BANDWIDTH': 'bandwidth',
        'DECODE': 'decode', 'PROTOCOL': 'protocol', 'SERIAL BUS': 'serial_bus',
        'I2C': 'I2C', 'SPI': 'SPI', 'UART': 'UART', 'RS232': 'RS232', 'RS-232': 'RS232',
        'CAN BUS': 'CAN', 'LIN BUS': 'LIN', 'MIL-STD-1553': 'MIL_STD_1553', '1553': 'MIL_STD_1553',
        'PARALLEL BUS': 'parallel',
        'ETHERNET': 'ethernet', 'USB ': 'USB',
        'FFT': 'FFT', 'SPECTRUM': 'spectrum', 'POWER': 'power',
        'JITTER': 'jitter', 'EYE DIAGRAM': 'eye_diagram',
        'MEASUREMENT': 'measurement', 'CURSOR': 'cursor',
        'ACQUISITION': 'acquisition', 'SAMPLE RATE': 'sample_rate',
        'WAVEFORM': 'waveform', 'MATH': 'math',
        'CALIBRATION': 'calibration', 'COMPENSATION': 'compensation',
        'OSCILLOSCOPE': 'oscilloscope',
        'SIGNAL INTEGRITY': 'signal_integrity',
        'DEBUG': 'debug', 'EMI': 'EMI', 'EMC': 'EMC',
        'NOISE': 'noise', 'GROUND': 'grounding',
        'CURRENT PROBE': 'current_probe', 'DIFFERENTIAL PROBE': 'differential_probe',
        'POWER RAIL': 'power_rail', 'PASSIVE PROBE': 'passive_probe',
        'SCPI': 'SCPI', 'GPIB': 'GPIB', 'REMOTE CONTROL': 'remote_control',
        'SPECTRUM VIEW': 'spectrum_view', 'SEARCH': 'search',
        'MASK': 'mask_testing',
    }
    for keyword, tag in topics.items():
        if keyword in combined:
            topic_tags.add(tag)

    # Content-type tags: derived from title ONLY to avoid false positives from
    # body text (e.g. nav sidebars on tek.com often contain the word "FAQ").
    content_type_tags = set()
    if 'APPLICATION NOTE' in title_upper or 'APP NOTE' in title_upper:
        content_type_tags.add('app_note')
    if 'PRIMER' in title_upper:
        content_type_tags.add('primer')
    if 'DATASHEET' in title_upper:
        content_type_tags.add('datasheet')
    if 'FAQ' in title_upper:
        content_type_tags.add('faq')
    if 'TECHNICAL BRIEF' in title_upper:
        content_type_tags.add('tech_brief')
    if 'BLOG' in title_upper:
        content_type_tags.add('blog')

    # Priority ordering: content-type first (never truncated), then topics, then model tags.
    # This ensures structural tags like 'faq' survive the 12-tag limit even on heavily
    # model-tagged pages (e.g. I2C FAQ that mentions 8 different oscilloscope models).
    ordered = sorted(content_type_tags) + sorted(topic_tags) + sorted(model_tags)
    # Deduplicate while preserving order
    seen = set()
    result = []
    for tag in ordered:
        if tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result[:16]  # raised from 12 → 16 so model tags don't crowd out topic tags


def make_chunk(title, body, source, page_num=1, prefix="tek"):
    if word_count(body) < MIN_WORDS:
        return False
    if body.strip().startswith('Contact us Request Services'):
        return False
    # Skip if body is mostly navigation/boilerplate
    nav_words = ['login', 'cart', 'menu', 'search', 'newsletter', 'subscribe', 'copyright']
    nav_count = sum(1 for w in nav_words if w in body.lower()[:200])
    if nav_count >= 3:
        return False

    slug = slugify(title)
    chunk_id = f"{prefix}_{slug}_p{page_num}"
    if chunk_id in seen_ids:
        h = hashlib.md5(body[:200].encode()).hexdigest()[:6]
        chunk_id = f"{prefix}_{slug}_{h}_p{page_num}"
    if chunk_id in seen_ids:
        return False
    seen_ids.add(chunk_id)

    tags = extract_tags(title, body)
    chunk = {
        "id": chunk_id,
        "corpus": CORPUS,
        "title": title,
        "body": body,
        "tags": tags,
        "source": source,
    }
    all_chunks.append(chunk)
    return True


def categorize_url(url):
    """Determine the content category from URL."""
    if '/application-note' in url:
        return 'Application Note'
    elif '/primer' in url:
        return 'Primer'
    elif '/technical-brief' in url:
        return 'Technical Brief'
    elif '/datasheet' in url:
        return 'Datasheet'
    elif '/faq' in url:
        return 'FAQ'
    elif '/blog/' in url:
        return 'Blog'
    elif '/article/' in url:
        return 'Article'
    elif '/products/' in url:
        return 'Product'
    elif '/manual/' in url or '-manual/' in url:
        return 'Manual'
    elif 'landing-page' in url:
        return 'Guide'
    else:
        return 'Document'


def find_pdf_url(soup, page_url):
    """Try to find a PDF download link on the page."""
    # Common patterns on tek.com PDF pages
    for a in soup.find_all('a', href=True):
        href = a['href']
        if href.lower().endswith('.pdf') or 'download.tek.com' in href:
            return urljoin(page_url, href)
    # Also check meta tags / og:url
    for meta in soup.find_all('meta', attrs={'property': 'og:url'}):
        content = meta.get('content', '')
        if content.lower().endswith('.pdf'):
            return content
    return None


def make_pdf_ref_chunk(title, source_url, pdf_url, category, page_text=""):
    """
    For PDF-only (or short-content) pages: create one chunk that includes
    whatever page text exists PLUS a pointer to the PDF for full content.
    AI can then decide whether the snippet is enough or to fetch the PDF.
    """
    parts = []
    if page_text.strip():
        parts.append(page_text.strip())
    parts.append(
        f"Full document available as PDF — fetch: {pdf_url}"
    )
    body = " ".join(parts)

    # Must have at least a title + PDF pointer to be useful
    if not pdf_url and not page_text.strip():
        return False

    tags = extract_tags(title, body)
    type_tag = category.lower().replace(' ', '_')
    if type_tag not in tags:
        tags.append(type_tag)

    slug = slugify(title)
    chunk_id = f"tek_{slug}_pdf_ref"
    if chunk_id in seen_ids:
        h = hashlib.md5(source_url.encode()).hexdigest()[:6]
        chunk_id = f"tek_{slug}_{h}_pdf_ref"
    if chunk_id in seen_ids:
        return False
    seen_ids.add(chunk_id)

    chunk = {
        "id": chunk_id,
        "corpus": CORPUS,
        "title": title,
        "body": body[:3000],
        "tags": sorted(set(tags))[:12],
        "source": source_url,
        "pdf_url": pdf_url,
    }
    all_chunks.append(chunk)
    return True


def process_page(url):
    """Fetch and process a single page into chunks."""
    html_text = fetch(url)
    if not html_text:
        failed_urls.append(url)
        return 0

    soup = BeautifulSoup(html_text, 'lxml')
    category = categorize_url(url)

    # Get page title
    page_title = ""
    title_el = soup.select_one('h1')
    if title_el:
        page_title = clean_text(title_el.get_text())
    elif soup.title:
        page_title = clean_text(soup.title.string or '')
        page_title = page_title.replace(' | Tektronix', '').strip()

    if not page_title:
        page_title = "Tektronix Document"

    full_title = f"{category}: {page_title}" if category else page_title

    content = extract_main_content(soup)
    chunks_added = 0

    # Try splitting by headings
    sections = split_by_headings(content)

    if sections and len(sections) > 1:
        page_num = 1
        for heading, text in sections:
            section_title = f"{full_title} - {heading}" if heading else full_title
            sub_chunks = chunk_text(text)
            for chunk_body in sub_chunks:
                if make_chunk(section_title, chunk_body, url, page_num):
                    chunks_added += 1
                page_num += 1
    else:
        # Fallback: get all text
        full_text = clean_text(content.get_text(' ', strip=True))
        if word_count(full_text) >= MIN_WORDS:
            sub_chunks = chunk_text(full_text)
            for i, chunk_body in enumerate(sub_chunks):
                if make_chunk(full_title, chunk_body, url, i + 1):
                    chunks_added += 1

    # If no full chunks extracted — page is likely PDF-only or very short.
    # Grab whatever text is on the page (abstract/description) + PDF link.
    # AI gets the snippet + can fetch the PDF for full content.
    if chunks_added == 0:
        pdf_url = find_pdf_url(soup, url)
        # Get whatever text exists on the page (even if short)
        page_text = clean_text(content.get_text(' ', strip=True))
        # Trim to a reasonable abstract length
        page_text_trimmed = ' '.join(page_text.split()[:300])
        if pdf_url or page_text_trimmed:
            if make_pdf_ref_chunk(full_title, url, pdf_url or '', category, page_text_trimmed):
                chunks_added += 1
                success_urls.append(url)
                return chunks_added
        return 0

    success_urls.append(url)
    return chunks_added


# ============================================================
# MAIN
# ============================================================

print("="*60)
print("TEKTRONIX DOCUMENTATION SCRAPER v2")
print("="*60)

# Load URLs
with open('/tmp/tek_final_urls.txt') as f:
    urls = [line.strip() for line in f if line.strip()]

# Incremental mode: if an existing output file is present, skip URLs already scraped.
# This lets you re-run after adding new URLs without re-fetching everything.
existing_output = "/home/exedev/tek_docs_scraped.json"
already_scraped_sources = set()
if os.path.exists(existing_output):
    try:
        existing_chunks = json.load(open(existing_output))
        for c in existing_chunks:
            src = c.get('source', '')
            if src:
                already_scraped_sources.add(src)
            # Also pre-populate seen_ids so we don't create duplicate IDs
            if c.get('id'):
                seen_ids.add(c['id'])
        all_chunks.extend(existing_chunks)
        print(f"Incremental mode: loaded {len(existing_chunks)} existing chunks, {len(already_scraped_sources)} scraped sources")
    except Exception as e:
        print(f"Warning: could not load existing output ({e}), starting fresh")

urls_to_scrape = [u for u in urls if u not in already_scraped_sources]
print(f"Loaded {len(urls)} URLs total, {len(urls_to_scrape)} new to scrape")
urls = urls_to_scrape
print()

total_chunks = 0
for i, url in enumerate(urls):
    sys.stdout.write(f"[{i+1}/{len(urls)}] {url[:80]}... ")
    sys.stdout.flush()
    n = process_page(url)
    print(f"+{n} chunks (total: {len(all_chunks)})")

print()
print("="*60)
print(f"SCRAPING COMPLETE")
print(f"  URLs attempted: {len(urls)}")
print(f"  URLs successful: {len(success_urls)}")
print(f"  URLs failed: {len(failed_urls)}")
print(f"  Total chunks: {len(all_chunks)}")
print("="*60)

# Write output
output_path = "/home/exedev/tek_docs_scraped.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(all_chunks, f, indent=2, ensure_ascii=False)

print(f"\nOutput: {output_path}")

if all_chunks:
    wcs = [word_count(c['body']) for c in all_chunks]
    print(f"Word count: {min(wcs)}-{max(wcs)} (avg {sum(wcs)//len(wcs)})")
    all_tags = set()
    for c in all_chunks:
        all_tags.update(c['tags'])
    print(f"Unique tags ({len(all_tags)}): {sorted(all_tags)}")

# Also write failed URLs for debugging
with open('/tmp/tek_failed_urls.txt', 'w') as f:
    f.write('\n'.join(failed_urls))
print(f"Failed URLs written to /tmp/tek_failed_urls.txt")
