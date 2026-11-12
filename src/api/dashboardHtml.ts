export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cross-Document Reconciliation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #F8FAFC;
      --surface: #FFFFFF;
      --border: #E2E8F0;
      --soft-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
      --text: #0F172A;
      --muted: #64748B;
      --accent: #0F766E;
      --accent-hover: #115E59;
      --match: #16A34A;
      --match-bg: #DCFCE7;
      --mismatch: #DC2626;
      --mismatch-bg: #FEE2E2;
      --review: #D97706;
      --review-bg: #FEF3C7;
      --open: #64748B;
      --open-bg: #F1F5F9;
      --evidence-highlight: #FEF08A;
      --radius-card: 8px;
      --radius-btn: 6px;
      --radius-input: 6px;
      --transition-speed: 120ms;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      background-color: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
    }

    .mono {
      font-family: 'IBM Plex Mono', ui-monospace, monospace;
      font-feature-settings: 'tnum' 1;
    }

    .tabular-nums {
      font-variant-numeric: tabular-nums;
    }

    /* Headings */
    h1, h2, h3, h4 {
      font-weight: 500;
      color: var(--text);
    }
    .page-title {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    /* Buttons */
    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background-color: var(--accent);
      color: #FFFFFF;
      border: 1px solid transparent;
      border-radius: var(--radius-btn);
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color var(--transition-speed) ease, border-color var(--transition-speed) ease;
    }
    .btn-primary:hover {
      background-color: var(--accent-hover);
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background-color: transparent;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-btn);
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color var(--transition-speed) ease, border-color var(--transition-speed) ease;
    }
    .btn-secondary:hover {
      background-color: var(--bg);
      border-color: #CBD5E1;
    }
    .btn-secondary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-sm {
      padding: 4px 10px;
      font-size: 12px;
    }

    /* Inputs */
    input[type="text"], input[type="search"], select, textarea {
      font-family: inherit;
      font-size: 13px;
      color: var(--text);
      background-color: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-input);
      padding: 6px 10px;
      outline: none;
      transition: border-color var(--transition-speed) ease;
      width: 100%;
    }
    input[type="text"]:focus, input[type="search"]:focus, select:focus, textarea:focus {
      border-color: var(--accent);
    }

    /* Cards */
    .card {
      background-color: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      box-shadow: var(--soft-shadow);
    }

    /* Status Chips */
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.3;
      white-space: nowrap;
    }
    .chip svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
    }
    .chip-match {
      background-color: var(--match-bg);
      color: var(--match);
    }
    .chip-mismatch {
      background-color: var(--mismatch-bg);
      color: var(--mismatch);
    }
    .chip-review {
      background-color: var(--review-bg);
      color: var(--review);
    }
    .chip-open {
      background-color: var(--open-bg);
      color: var(--open);
    }

    /* Table Styles */
    .recon-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .recon-table th {
      text-align: left;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      background-color: var(--bg);
    }
    .recon-table th.num-col {
      text-align: right;
    }
    .recon-table td {
      padding: 10px 12px;
      height: 44px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
      transition: background-color var(--transition-speed) ease;
    }
    .recon-table td.num-col {
      text-align: right;
    }
    .recon-table tr:hover td {
      background-color: var(--bg);
    }
    .cell-conflict {
      background-color: var(--mismatch-bg) !important;
      color: var(--mismatch);
      font-weight: 500;
      cursor: pointer;
      position: relative;
    }
    .cell-conflict:hover {
      filter: brightness(0.97);
    }
    .cell-interactive {
      cursor: pointer;
    }
    .cell-interactive:hover {
      text-decoration: underline;
    }

    /* Value Tooltip (Raw & Normalized) */
    .val-wrap {
      position: relative;
      display: inline-block;
    }
    .val-wrap:hover .val-tooltip {
      visibility: visible;
      opacity: 1;
    }
    .val-tooltip {
      visibility: hidden;
      opacity: 0;
      position: absolute;
      bottom: 125%;
      left: 50%;
      transform: translateX(-50%);
      background-color: var(--text);
      color: #FFFFFF;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      white-space: nowrap;
      z-index: 30;
      pointer-events: none;
      transition: opacity var(--transition-speed) ease;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }

    /* Skeleton Loader */
    .skeleton {
      background: linear-gradient(90deg, #E2E8F0 25%, #F1F5F9 50%, #E2E8F0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s infinite;
      border-radius: 4px;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Drawer Animation (<150ms) */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background-color: rgba(15, 23, 42, 0.4);
      z-index: 90;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease;
    }
    .drawer-backdrop.active {
      opacity: 1;
      pointer-events: auto;
    }

    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 440px;
      max-width: 100vw;
      background-color: var(--surface);
      border-left: 1px solid var(--border);
      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
      z-index: 100;
      transform: translateX(100%);
      transition: transform 120ms ease;
      display: flex;
      flex-direction: column;
    }
    .drawer.active {
      transform: translateX(0);
    }

    /* Source Tabs */
    .tab-btn {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: color var(--transition-speed) ease, border-color var(--transition-speed) ease;
    }
    .tab-btn:hover {
      color: var(--text);
    }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    /* Evidence Highlight Pulse */
    .evidence-highlight {
      background-color: var(--evidence-highlight) !important;
      padding: 1px 4px;
      border-radius: 2px;
      transition: background-color 150ms ease;
    }
    .evidence-focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      animation: focus-pulse 1s ease;
    }
    @keyframes focus-pulse {
      0% { outline-color: var(--accent); }
      50% { outline-color: transparent; }
      100% { outline-color: var(--accent); }
    }

    /* Drop Zone Slots */
    .drop-slot {
      border: 1px dashed var(--border);
      border-radius: var(--radius-card);
      padding: 16px;
      background-color: var(--surface);
      text-align: center;
      cursor: pointer;
      transition: border-color var(--transition-speed) ease, background-color var(--transition-speed) ease;
      position: relative;
    }
    .drop-slot:hover {
      border-color: var(--accent);
      background-color: #F0FDFA;
    }
    .drop-slot.ready {
      border-color: var(--match);
      border-style: solid;
      background-color: #F0FDF4;
    }

    /* Layout Utility */
    .flex-col { display: flex; flex-direction: column; }
    .flex-row { display: flex; flex-direction: row; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .gap-2 { gap: 8px; }
    .gap-3 { gap: 12px; }
    .gap-4 { gap: 16px; }
    .gap-6 { gap: 24px; }
  </style>
</head>
<body style="min-height: 100vh; display: flex; flex-direction: column;">

  <!-- Main Top Bar -->
  <header style="background-color: var(--surface); border-bottom: 1px solid var(--border); height: 52px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-weight: 600; font-size: 15px; color: var(--accent); letter-spacing: -0.01em;">ReconcileOps</span>
      <span style="color: var(--border);">|</span>
      <span style="color: var(--muted); font-size: 13px;">Cross-Document Reconciliation Engine</span>
    </div>

    <div style="display: flex; align-items: center; gap: 10px;">
      <button onclick="checkDeadlinesNow()" class="btn-secondary btn-sm" title="Check SLAs and deadlines">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>Check Deadlines</span>
      </button>
      <button onclick="loadAllData()" class="btn-secondary btn-sm" title="Refresh data">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
        <span>Refresh</span>
      </button>
    </div>
  </header>

  <!-- Body Workspace with Sidebar -->
  <div style="flex: 1; display: flex; overflow: hidden;">

    <!-- Narrow Left Sidebar -->
    <aside style="width: 260px; background-color: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0;">
      
      <!-- Nav Tabs -->
      <nav style="padding: 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px;">
        <button id="navCasesBtn" onclick="switchMainView('cases')" class="btn-secondary" style="justify-content: flex-start; border: none; padding: 8px 12px; font-weight: 500; background-color: var(--bg);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          <span style="flex: 1; text-align: left;">Processing Cases</span>
          <span id="caseCountBadge" class="chip chip-open">0</span>
        </button>
        <button id="navReviewQueueBtn" onclick="switchMainView('queues')" class="btn-secondary" style="justify-content: flex-start; border: none; padding: 8px 12px; font-weight: 500;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          <span style="flex: 1; text-align: left;">Review Queue</span>
          <span id="queueCountBadge" class="chip chip-review">0</span>
        </button>
        <button id="navUnlinkedBtn" onclick="switchMainView('unlinked')" class="btn-secondary" style="justify-content: flex-start; border: none; padding: 8px 12px; font-weight: 500;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
          <span style="flex: 1; text-align: left;">Unlinked Docs</span>
          <span id="unlinkedCountBadge" class="chip chip-open">0</span>
        </button>
        <button id="navUploadBtn" onclick="switchMainView('upload')" class="btn-primary" style="justify-content: flex-start; margin-top: 6px; padding: 8px 12px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          <span>Upload Documents</span>
        </button>
      </nav>

      <!-- Sidebar Case Search & List (Visible when on Cases view) -->
      <div id="sidebarCaseListSection" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <div style="padding: 10px 12px; border-bottom: 1px solid var(--border);">
          <input type="search" id="caseSearchInput" oninput="filterCaseList()" placeholder="Filter PO or Customer..." style="font-size: 12px; padding: 6px 8px;">
        </div>
        <div id="caseListContainer" style="flex: 1; overflow-y: auto; padding: 6px;">
          <div style="padding: 16px; text-align: center; color: var(--muted); font-size: 12px;">Loading cases...</div>
        </div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; background-color: var(--bg);">

      <!-- VIEW 1: CASES WORKSPACE -->
      <div id="casesView" style="flex: 1; display: flex; flex-direction: column; padding: 20px; gap: 20px;">
        
        <!-- Empty State -->
        <div id="caseEmptyState" class="card" style="padding: 48px 24px; text-align: center; margin: auto; max-width: 480px;">
          <h3 style="font-size: 16px; margin-bottom: 6px;">No Case Selected</h3>
          <p style="color: var(--muted); font-size: 13px; margin-bottom: 18px;">
            Select an order case from the sidebar to inspect matched line items, or upload Email, PDF, and JSON documents to begin reconciliation.
          </p>
          <button onclick="switchMainView('upload')" class="btn-primary">
            Upload Documents
          </button>
        </div>

        <!-- Case Detail Content (Hidden when empty) -->
        <div id="caseDetailContainer" style="display: none; flex-direction: column; gap: 20px;">
          
          <!-- Case Header Strip -->
          <div class="card" style="padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
              <span id="headerPoNumber" class="mono page-title" style="font-size: 18px;">PO-9001</span>
              <span id="headerCustomerName" style="color: var(--muted); font-size: 13px;">Acme Corp (CUST-001)</span>
              
              <!-- Status Chip -->
              <span id="headerStatusChip" class="chip chip-open">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span>OPEN</span>
              </span>

              <!-- Waiting For Chip (if applicable) -->
              <span id="headerWaitingChip" class="chip chip-open" style="display: none;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <span id="headerWaitingText">waiting for: JSON</span>
              </span>
            </div>

            <div style="display: flex; align-items: center; gap: 8px;">
              <button onclick="runCaseReconciliation()" id="runReconBtn" class="btn-primary btn-sm">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Run Reconciliation</span>
              </button>
              <button onclick="openReviewDrawerForActiveCase()" class="btn-secondary btn-sm">
                <span>Review Case</span>
              </button>
              <button onclick="openAuditDrawerForActiveCase()" id="auditHistoryBtn" class="btn-secondary btn-sm" title="View chronological case & document audit logs">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                <span>Audit Trail</span>
              </button>
            </div>
          </div>

          <!-- Two Column Workspace: Left 60% Reconciliation Table / Right 40% Source Viewer -->
          <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
            
            <!-- Left Column (~60%) -->
            <div style="flex: 3; min-width: 520px; display: flex; flex-direction: column; gap: 20px;">
              
              <!-- Reconciliation Table Card -->
              <div class="card" style="overflow: hidden;">
                <div style="padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
                  <div>
                    <h3 style="font-size: 14px;">Reconciliation Comparison</h3>
                    <p style="font-size: 12px; color: var(--muted); margin-top: 1px;">Deterministic alignment across Email, PDF, and JSON. Click any conflicting cell to inspect source evidence.</p>
                  </div>
                </div>

                <div style="overflow-x: auto;">
                  <table class="recon-table">
                    <thead>
                      <tr>
                        <th style="width: 100px;">SKU</th>
                        <th>Description</th>
                        <th class="num-col" style="width: 130px;">Email</th>
                        <th class="num-col" style="width: 130px;">PDF</th>
                        <th class="num-col" style="width: 130px;">JSON</th>
                        <th style="width: 90px; text-align: center;">Result</th>
                      </tr>
                    </thead>
                    <tbody id="reconTableBody">
                      <!-- Rendered dynamically -->
                    </tbody>
                  </table>
                </div>

                <!-- Order Amounts Comparison (Subtotal, Tax, Freight, Grand Total) -->
                <div style="padding: 12px 16px; border-top: 1px solid var(--border); background-color: #FAFAFA;">
                  <div style="font-size: 12px; font-weight: 500; color: var(--muted); margin-bottom: 8px;">Order Amounts Comparison</div>
                  <div id="amountsComparisonList" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
                    <!-- Rendered dynamically -->
                  </div>
                </div>
              </div>

              <!-- Issue List Panel (ALWAYS VISIBLE, never in a hidden tab) -->
              <div class="card" style="padding: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <h3 style="font-size: 14px;">Active Issues & Discrepancies</h3>
                    <span id="issueCountBadge" class="chip chip-review">0</span>
                  </div>
                  <span style="font-size: 11px; color: var(--muted);">Use ↑/↓ arrows to navigate, Enter to inspect evidence</span>
                </div>

                <div id="issuesListContainer" style="display: flex; flex-direction: column; gap: 8px;">
                  <!-- Rendered dynamically -->
                </div>
              </div>

              <!-- Review Decisions History Card (Phase 3) -->
              <div class="card" style="padding: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <h3 style="font-size: 14px;">Review Decisions History</h3>
                    <span id="decisionCountBadge" class="chip chip-open">0</span>
                  </div>
                  <span style="font-size: 11px; color: var(--muted);">Active decisions apply; superseded decisions struck through for audit.</span>
                </div>

                <div id="reviewDecisionsHistoryContainer" style="display: flex; flex-direction: column; gap: 8px;">
                  <div style="color: var(--muted); font-size: 12px; font-style: italic;">No review decisions recorded for this case.</div>
                </div>
              </div>

            </div>

            <!-- Right Column (~40%): Source Viewer with Tabs -->
            <div style="flex: 2; min-width: 380px;" class="card">
              
              <!-- Source Viewer Header & Tabs -->
              <div style="border-bottom: 1px solid var(--border); padding: 4px 12px 0 12px; display: flex; align-items: center; justify-content: space-between; background-color: var(--bg);">
                <div style="display: flex; gap: 2px;">
                  <button id="tabBtnEmail" onclick="selectSourceTab('EMAIL')" class="tab-btn active">
                    <span>Email</span>
                    <span id="tabEmailStatus" style="width: 6px; height: 6px; border-radius: 9999px; background-color: var(--muted);"></span>
                  </button>
                  <button id="tabBtnPdf" onclick="selectSourceTab('PDF')" class="tab-btn">
                    <span>PDF</span>
                    <span id="tabPdfStatus" style="width: 6px; height: 6px; border-radius: 9999px; background-color: var(--muted);"></span>
                  </button>
                  <button id="tabBtnJson" onclick="selectSourceTab('JSON')" class="tab-btn">
                    <span>JSON</span>
                    <span id="tabJsonStatus" style="width: 6px; height: 6px; border-radius: 9999px; background-color: var(--muted);"></span>
                  </button>
                </div>

                <span id="sourceViewerMeta" style="font-size: 11px; color: var(--muted);">-</span>
              </div>

              <!-- Source Viewer Content -->
              <div id="sourceViewerBody" style="padding: 14px; min-height: 480px; max-height: calc(100vh - 220px); overflow-y: auto; font-size: 12px; line-height: 1.6;">
                <div style="color: var(--muted); text-align: center; padding-top: 40px;">Select a line item or cell to view source evidence.</div>
              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- VIEW 2: REVIEW QUEUE -->
      <div id="queuesView" style="display: none; padding: 20px; flex-direction: column; gap: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <h2 class="page-title">Operational Review Queue</h2>
            <p style="font-size: 13px; color: var(--muted); margin-top: 2px;">Manage unlinked files, multi-customer PO collisions, and sender conflicts requiring human verification.</p>
          </div>
          <select id="queueFilterSelect" onchange="filterQueues()" style="width: 200px;">
            <option value="">All Queue Types</option>
            <option value="UNLINKED">Unlinked Documents</option>
            <option value="POSSIBLE_MATCH">PO Collisions</option>
            <option value="IDENTITY_CONFLICT">Identity Conflicts</option>
          </select>
        </div>

        <div class="card" style="overflow: hidden;">
          <table class="recon-table">
            <thead>
              <tr>
                <th>Queue Item ID</th>
                <th>Type</th>
                <th>Document / Case</th>
                <th>Details</th>
                <th>Created At</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody id="queuesTableBody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- VIEW 3: UNLINKED DOCS -->
      <div id="unlinkedView" style="display: none; padding: 20px; flex-direction: column; gap: 16px;">
        <div>
          <h2 class="page-title">Unlinked Documents</h2>
          <p style="font-size: 13px; color: var(--muted); margin-top: 2px;">Documents awaiting linking to an existing PO or new case.</p>
        </div>

        <div class="card" style="overflow: hidden;">
          <table class="recon-table">
            <thead>
              <tr>
                <th>Document ID</th>
                <th>Source Type</th>
                <th>Sender / Path</th>
                <th>Extracted PO</th>
                <th>Status</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody id="unlinkedTableBody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- VIEW 4: UPLOAD (DROP ZONE WITH THREE LABELLED SLOTS THAT TICK OFF) -->
      <div id="uploadView" style="display: none; padding: 20px; flex-direction: column; gap: 20px; max-width: 800px; margin: 0 auto; width: 100%;">
        <div>
          <h2 class="page-title">Upload Documents</h2>
          <p style="font-size: 13px; color: var(--muted); margin-top: 2px;">Drop or select the matching Email, PDF, and JSON order documents. Each slot ticks off as files arrive.</p>
        </div>

        <div class="card" style="padding: 20px; display: flex; flex-direction: column; gap: 18px;">
          
          <!-- Metadata Fields -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <div>
              <label style="font-size: 12px; font-weight: 500; color: var(--muted); display: block; margin-bottom: 4px;">PO Number (Optional, auto-extracted if empty)</label>
              <input type="text" id="uploadPoNumber" placeholder="e.g. PO-9001" class="mono">
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 500; color: var(--muted); display: block; margin-bottom: 4px;">Customer ID (Optional)</label>
              <input type="text" id="uploadCustomerId" placeholder="e.g. CUST-001" class="mono">
            </div>
          </div>

          <!-- Three Labelled Drop Slots -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;">
            
            <!-- Slot 1: EMAIL -->
            <div id="slotEmail" class="drop-slot" onclick="document.getElementById('fileInputEmail').click()">
              <input type="file" id="fileInputEmail" accept=".eml,.txt" style="display: none;" onchange="handleFilePicked('EMAIL', this.files[0])">
              <div style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">Email Document</div>
              <div style="font-size: 12px; color: var(--muted);" id="slotEmailStatus">Drop .eml or .txt</div>
              <div id="slotEmailCheck" style="display: none; margin-top: 8px;">
                <span class="chip chip-match">✓ Ready</span>
              </div>
            </div>

            <!-- Slot 2: PDF -->
            <div id="slotPdf" class="drop-slot" onclick="document.getElementById('fileInputPdf').click()">
              <input type="file" id="fileInputPdf" accept=".pdf" style="display: none;" onchange="handleFilePicked('PDF', this.files[0])">
              <div style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">PDF Document</div>
              <div style="font-size: 12px; color: var(--muted);" id="slotPdfStatus">Drop .pdf</div>
              <div id="slotPdfCheck" style="display: none; margin-top: 8px;">
                <span class="chip chip-match">✓ Ready</span>
              </div>
            </div>

            <!-- Slot 3: JSON -->
            <div id="slotJson" class="drop-slot" onclick="document.getElementById('fileInputJson').click()">
              <input type="file" id="fileInputJson" accept=".json" style="display: none;" onchange="handleFilePicked('JSON', this.files[0])">
              <div style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">JSON Document</div>
              <div style="font-size: 12px; color: var(--muted);" id="slotJsonStatus">Drop .json</div>
              <div id="slotJsonCheck" style="display: none; margin-top: 8px;">
                <span class="chip chip-match">✓ Ready</span>
              </div>
            </div>

          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px;">
            <button type="button" onclick="resetUploadSlots()" class="btn-secondary">Clear</button>
            <button type="button" id="startUploadBtn" onclick="submitUploadedDocuments()" class="btn-primary" disabled>
              Process & Reconcile
            </button>
          </div>

        </div>
      </div>

    </main>

  </div>

  <!-- SLIDE-OVER REVIEW DRAWER (Not a modal! Easily closeable) -->
  <div id="drawerBackdrop" class="drawer-backdrop" onclick="closeReviewDrawer()"></div>
  <aside id="reviewDrawer" class="drawer" aria-labelledby="drawerTitle">
    <div style="padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h3 id="drawerTitle" style="font-size: 16px; font-weight: 600;">Manual Review Decision</h3>
        <p style="font-size: 12px; color: var(--muted); margin-top: 2px;">Resolve line item or total discrepancies with an audit-logged decision.</p>
      </div>
      <button onclick="closeReviewDrawer()" class="btn-secondary btn-sm" style="padding: 4px 8px; border: none; font-size: 16px;" aria-label="Close drawer">✕</button>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px;">
      
      <!-- Issue Context Card -->
      <div class="card" style="padding: 12px; background-color: var(--bg);">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; margin-bottom: 4px;">Discrepancy Details</div>
        <div id="drawerIssueMessage" style="font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 8px;">Quantity differs: 10 in PDF, 12 in JSON</div>
        <div id="drawerIssueMeta" class="mono" style="font-size: 11px; color: var(--muted);">SKU: SKU-001 • Field: quantity</div>
        
        <!-- AI Root Cause & Recommendation Insight -->
        <div id="drawerAiBox" style="margin-top: 10px; padding: 10px 12px; border-radius: var(--radius-btn); background-color: #f0fdf4; border: 1px solid #bbf7d0; display: none;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-size: 10px; font-weight: 700; background: #166534; color: white; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">AI Root Cause Insight</span>
            <span id="drawerAiModelBadge" class="mono" style="font-size: 10px; color: #166534;"></span>
          </div>
          <div id="drawerAiSummary" style="font-size: 12px; color: #14532d; line-height: 1.45; margin-bottom: 6px;"></div>
          <div style="font-size: 11px; font-weight: 600; color: #166534; margin-bottom: 2px;">Recommendation:</div>
          <div id="drawerAiRecommendation" style="font-size: 11px; color: #15803d; line-height: 1.4;"></div>
        </div>
      </div>

      <!-- Selection Options Form -->
      <div>
        <label style="font-size: 12px; font-weight: 600; color: var(--text); display: block; margin-bottom: 8px;">Select Winning Value</label>
        <div id="drawerCandidateValuesContainer" style="display: flex; flex-direction: column; gap: 8px;">
          <!-- Radio options rendered dynamically -->
        </div>
      </div>

      <!-- Custom Value Input -->
      <div>
        <label style="font-size: 12px; font-weight: 500; color: var(--muted); display: block; margin-bottom: 4px;">Or Custom Override Value</label>
        <input type="text" id="drawerCustomValue" placeholder="Enter override value..." class="mono">
      </div>

      <!-- Reviewer Name -->
      <div>
        <label style="font-size: 12px; font-weight: 500; color: var(--muted); display: block; margin-bottom: 4px;">Reviewer Identity</label>
        <input type="text" id="drawerReviewerName" value="Operations Team" required>
      </div>

      <!-- Justification / Reason -->
      <div>
        <label style="font-size: 12px; font-weight: 500; color: var(--muted); display: block; margin-bottom: 4px;">Reason / Business Justification</label>
        <textarea id="drawerReason" rows="3" placeholder="Explain the resolution reason (e.g. Verified with supplier via PO copy)..." required></textarea>
      </div>

    </div>

    <!-- Drawer Footer Actions -->
    <div style="padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; background-color: var(--surface);">
      <button onclick="closeReviewDrawer()" class="btn-secondary">Cancel</button>
      <button onclick="submitReviewDecision()" id="drawerSubmitBtn" class="btn-primary">
        Confirm Decision
      </button>
    </div>
  </aside>

  <!-- SLIDE-OVER AUDIT LOG DRAWER (Phase 3) -->
  <div id="auditDrawerBackdrop" class="drawer-backdrop" onclick="closeAuditDrawer()"></div>
  <aside id="auditDrawer" class="drawer" style="width: 520px;" aria-labelledby="auditDrawerTitle">
    <div style="padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h3 id="auditDrawerTitle" style="font-size: 16px; font-weight: 600;">Case Audit Trail</h3>
        <p style="font-size: 12px; color: var(--muted); margin-top: 2px;">Chronological timeline of all system and user operations for this case.</p>
      </div>
      <button onclick="closeAuditDrawer()" class="btn-secondary btn-sm" style="padding: 4px 8px; border: none; font-size: 16px;" aria-label="Close drawer">✕</button>
    </div>
    <div id="auditTimelineContainer" style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px;">
      <div style="color: var(--muted); font-size: 12px; text-align: center;">Loading audit timeline...</div>
    </div>
  </aside>

  <script>
    // State
    let allCases = [];
    let currentCase = null;
    let currentCaseDetails = null;
    let activeSourceTab = 'PDF';
    let activeIssueIndex = -1;
    let uploadedSlots = { EMAIL: null, PDF: null, JSON: null };
    let currentActiveReviewIssue = null;

    // Startup
    window.addEventListener('DOMContentLoaded', () => {
      loadAllData();
      setupKeyboardNavigation();
    });

    // Keyboard navigation (Up/Down arrow for issues, Enter for evidence, Escape for drawer)
    function setupKeyboardNavigation() {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeReviewDrawer();
          return;
        }

        const issues = currentCaseDetails?.latestResult?.issues || [];
        if (!issues.length) return;

        // Don't intercept when user is typing in an input
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIssueIndex = (activeIssueIndex + 1) % issues.length;
          highlightAndFocusIssue(activeIssueIndex);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIssueIndex = (activeIssueIndex - 1 + issues.length) % issues.length;
          highlightAndFocusIssue(activeIssueIndex);
        } else if (e.key === 'Enter' && activeIssueIndex >= 0) {
          e.preventDefault();
          inspectIssueByIndex(activeIssueIndex);
        }
      });
    }

    // Load Cases and Queues
    async function loadAllData() {
      try {
        const [casesRes, queueRes] = await Promise.all([
          fetch('/api/cases'),
          fetch('/api/queues')
        ]);

        if (casesRes.ok) {
          const casesData = await casesRes.json();
          allCases = casesData.cases || [];
          renderCaseList(allCases);
          document.getElementById('caseCountBadge').innerText = allCases.length;

          // If a case is already active, refresh it
          if (currentCase) {
            const found = allCases.find(c => c.id === currentCase.id);
            if (found) selectCase(found.id);
          } else if (allCases.length > 0) {
            selectCase(allCases[0].id);
          }
        }

        if (queueRes.ok) {
          const qData = await queueRes.json();
          const queues = qData.queues || [];
          document.getElementById('queueCountBadge').innerText = queues.filter(q => !q.resolved).length;
          const unlinkedCount = queues.filter(q => q.queue_type === 'UNLINKED' && !q.resolved).length;
          document.getElementById('unlinkedCountBadge').innerText = unlinkedCount;
          renderQueues(queues);
          renderUnlinked(queues.filter(q => q.queue_type === 'UNLINKED'));
        }
      } catch (err) {
        console.error('Failed to load portal data:', err);
      }
    }

    // View Switching
    function switchMainView(view) {
      document.getElementById('casesView').style.display = view === 'cases' ? 'flex' : 'none';
      document.getElementById('queuesView').style.display = view === 'queues' ? 'flex' : 'none';
      document.getElementById('unlinkedView').style.display = view === 'unlinked' ? 'flex' : 'none';
      document.getElementById('uploadView').style.display = view === 'upload' ? 'flex' : 'none';

      // Auto-prefill PO and Customer ID if an active case is selected
      if (view === 'upload' && currentCase) {
        const poInput = document.getElementById('uploadPoNumber');
        const custInput = document.getElementById('uploadCustomerId');
        if (poInput && !poInput.value) poInput.value = currentCase.po_number || '';
        if (custInput && !custInput.value) custInput.value = currentCase.customer_id || '';
      }

      // Update nav styling
      const btns = {
        cases: document.getElementById('navCasesBtn'),
        queues: document.getElementById('navReviewQueueBtn'),
        unlinked: document.getElementById('navUnlinkedBtn'),
      };
      Object.keys(btns).forEach(k => {
        if (btns[k]) {
          btns[k].style.backgroundColor = k === view ? 'var(--bg)' : 'transparent';
        }
      });
    }

    // Render Case List in Sidebar
    function renderCaseList(cases) {
      const container = document.getElementById('caseListContainer');
      if (!cases.length) {
        container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--muted); font-size: 12px;">No cases found</div>';
        return;
      }

      container.innerHTML = cases.map(c => {
        const isSelected = currentCase?.id === c.id;
        const status = c.latestResult?.status || c.status || 'OPEN';
        const chipClass = getStatusChipClass(status);
        const iconSvg = getStatusIconSvg(status);

        return \`
          <div onclick="selectCase('\${c.id}')" style="padding: 10px 12px; border-radius: var(--radius-btn); cursor: pointer; margin-bottom: 4px; background-color: \${isSelected ? 'var(--bg)' : 'transparent'}; border: 1px solid \${isSelected ? 'var(--border)' : 'transparent'}; transition: background-color 120ms ease;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span class="mono" style="font-weight: 600; font-size: 13px;">\${escapeHtml(c.po_number || 'PO-UNKNOWN')}</span>
              <span class="chip \${chipClass}">\${iconSvg} \${status}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--muted);">
              <span style="max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${escapeHtml(c.customer_id || 'Acme')}</span>
              <span>\${c.documentCount || 0} docs</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    function filterCaseList() {
      const query = document.getElementById('caseSearchInput').value.toLowerCase();
      const filtered = allCases.filter(c =>
        (c.po_number && c.po_number.toLowerCase().includes(query)) ||
        (c.customer_id && c.customer_id.toLowerCase().includes(query))
      );
      renderCaseList(filtered);
    }

    // Select Case
    async function selectCase(caseId) {
      switchMainView('cases');
      const c = allCases.find(item => item.id === caseId);
      currentCase = c || { id: caseId };

      renderCaseList(allCases); // Update active state highlight

      document.getElementById('caseEmptyState').style.display = 'none';
      const container = document.getElementById('caseDetailContainer');
      container.style.display = 'flex';

      // Show skeleton state while loading
      document.getElementById('reconTableBody').innerHTML = \`
        <tr><td colspan="6" style="padding: 24px;"><div class="skeleton" style="height: 24px; margin-bottom: 8px;"></div><div class="skeleton" style="height: 24px;"></div></td></tr>
      \`;

      try {
        const res = await fetch('/api/cases/' + caseId);
        if (!res.ok) throw new Error('Failed to load case');
        const data = await res.json();
        currentCaseDetails = data;
        renderCaseWorkspace(data);
      } catch (err) {
        console.error('Error loading case detail:', err);
      }
    }

    // Render Full Case Workspace
    function renderCaseWorkspace(data) {
      const c = data.case || {};
      const docs = data.documents || [];
      const latestResult = data.latestResult;

      // 1. Header Strip
      document.getElementById('headerPoNumber').innerText = c.po_number || 'PO-UNKNOWN';
      document.getElementById('headerCustomerName').innerText = (c.customer_name || 'Customer') + ' (' + (c.customer_id || '-') + ')';

      const status = latestResult?.status || c.status || 'OPEN';
      const statusChip = document.getElementById('headerStatusChip');
      statusChip.className = 'chip ' + getStatusChipClass(status);
      statusChip.innerHTML = getStatusIconSvg(status) + ' <span>' + status + '</span>';

      // Missing Sources Callout
      const sourceTypes = docs.map(d => d.source_type);
      const missingSources = ['EMAIL', 'PDF', 'JSON'].filter(s => !sourceTypes.includes(s));
      const waitingChip = document.getElementById('headerWaitingChip');
      if (missingSources.length > 0) {
        waitingChip.style.display = 'inline-flex';
        document.getElementById('headerWaitingText').innerText = 'waiting for: ' + missingSources.join(', ');
      } else {
        waitingChip.style.display = 'none';
      }

      // Update Source Tabs Status Dots
      updateSourceTabStatus('EMAIL', docs.some(d => d.source_type === 'EMAIL'));
      updateSourceTabStatus('PDF', docs.some(d => d.source_type === 'PDF'));
      updateSourceTabStatus('JSON', docs.some(d => d.source_type === 'JSON'));

      // 2. Reconciliation Table
      renderReconTable(docs, latestResult);

      // 3. Amounts Comparison
      renderAmountsComparison(docs, latestResult);

      // 4. Issue List (Always Visible!)
      renderIssuesList(latestResult?.issues || [], docs);

      // 5. Review Decisions History (Phase 3)
      renderReviewDecisionsHistory(data.allDecisions || data.decisions || data.activeDecisions || []);

      // 6. Source Viewer
      renderSourceViewerContent(activeSourceTab);
    }

    // Helper: Status Chips
    function getStatusChipClass(status) {
      if (status === 'MATCHED' || status === 'RESOLVED') return 'chip-match';
      if (status === 'MISMATCH') return 'chip-mismatch';
      if (status === 'REVIEW' || status === 'MANUAL_REVIEW' || status === 'REVIEW_REQUIRED') return 'chip-review';
      return 'chip-open';
    }

    function getStatusIconSvg(status) {
      if (status === 'MATCHED' || status === 'RESOLVED') {
        return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }
      if (status === 'MISMATCH') {
        return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
      }
      if (status === 'REVIEW' || status === 'MANUAL_REVIEW' || status === 'REVIEW_REQUIRED') {
        return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      }
      return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    }

    function updateSourceTabStatus(sourceType, isPresent) {
      const dot = document.getElementById('tab' + sourceType.charAt(0) + sourceType.slice(1).toLowerCase() + 'Status');
      if (dot) {
        dot.style.backgroundColor = isPresent ? 'var(--match)' : 'var(--muted)';
        dot.title = isPresent ? 'Document present' : 'Document missing';
      }
    }

    // Render Reconciliation Table
    function renderReconTable(docs, latestResult) {
      const tbody = document.getElementById('reconTableBody');
      const emailDoc = docs.find(d => d.source_type === 'EMAIL');
      const pdfDoc = docs.find(d => d.source_type === 'PDF');
      const jsonDoc = docs.find(d => d.source_type === 'JSON');

      const issues = latestResult?.issues || [];

      // Collect unique SKUs
      const skuSet = new Set();
      [emailDoc, pdfDoc, jsonDoc].forEach(doc => {
        if (doc?.stageA?.lineItems) {
          doc.stageA.lineItems.forEach(item => {
            if (item.productCode) skuSet.add(item.productCode);
          });
        }
      });

      if (!skuSet.size) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--muted);">No line items extracted. Ingest documents to compare.</td></tr>';
        return;
      }

      tbody.innerHTML = Array.from(skuSet).map(sku => {
        const eLine = emailDoc?.stageA?.lineItems?.find(i => i.productCode === sku);
        const pLine = pdfDoc?.stageA?.lineItems?.find(i => i.productCode === sku);
        const jLine = jsonDoc?.stageA?.lineItems?.find(i => i.productCode === sku);

        const desc = pLine?.description || jLine?.description || eLine?.description || '-';

        // Check SKU specific issues
        const skuIssues = issues.filter(i => (i.normalizedSku && i.normalizedSku === sku) || (i.field && i.field.includes(sku)));
        const hasIssue = skuIssues.length > 0;

        // Conflict detection per cell
        const isQtyConflict = (pLine && jLine && pLine.quantity !== jLine.quantity) || (eLine && pLine && eLine.quantity && eLine.quantity !== pLine.quantity);
        const isPriceConflict = (pLine && jLine && pLine.unitPrice && jLine.unitPrice && parseFloat(pLine.unitPrice) !== parseFloat(jLine.unitPrice));

        const formatCell = (line, srcType, isConflict) => {
          if (!line) return '<span style="color: var(--muted); font-size: 11px;">Missing</span>';
          const qty = line.quantity || '0';
          const price = line.unitPrice || '0';
          const tot = line.lineTotal || (parseFloat(qty) * parseFloat(price)).toFixed(2);
          const rawVal = line.rawText || (qty + ' @ ' + price);

          return \`
            <div class="val-wrap cell-interactive" onclick="jumpToEvidence('\${srcType}', '\${escapeHtml(sku)}')">
              <span class="mono tabular-nums">\${qty} @ \${price} = <strong>\${tot}</strong></span>
              <span class="val-tooltip">Raw: \${escapeHtml(rawVal)} → Norm: \${qty} @ \${price}</span>
            </div>
          \`;
        };

        const resultChip = !hasIssue
          ? '<span class="chip chip-match">' + getStatusIconSvg('MATCHED') + ' Match</span>'
          : '<span class="chip chip-mismatch">' + getStatusIconSvg('MISMATCH') + ' Review</span>';

        return \`
          <tr>
            <td class="mono" style="font-weight: 600; cursor: pointer;" onclick="jumpToEvidence('PDF', '\${escapeHtml(sku)}')">
              \${escapeHtml(sku)}
            </td>
            <td style="color: var(--muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              \${escapeHtml(desc)}
            </td>
            <td class="num-col \${(isQtyConflict || isPriceConflict) && eLine ? 'cell-conflict' : ''}">
              \${formatCell(eLine, 'EMAIL', isQtyConflict || isPriceConflict)}
            </td>
            <td class="num-col \${(isQtyConflict || isPriceConflict) && pLine ? 'cell-conflict' : ''}">
              \${formatCell(pLine, 'PDF', isQtyConflict || isPriceConflict)}
            </td>
            <td class="num-col \${(isQtyConflict || isPriceConflict) && jLine ? 'cell-conflict' : ''}">
              \${formatCell(jLine, 'JSON', isQtyConflict || isPriceConflict)}
            </td>
            <td style="text-align: center;">
              \${resultChip}
            </td>
          </tr>
        \`;
      }).join('');
    }

    // Render Amounts Comparison
    function renderAmountsComparison(docs, latestResult) {
      const container = document.getElementById('amountsComparisonList');
      const fields = [
        { key: 'subtotal', label: 'Subtotal' },
        { key: 'taxTotal', label: 'Taxes' },
        { key: 'freight', label: 'Freight' },
        { key: 'grandTotal', label: 'Grand Total' }
      ];

      container.innerHTML = fields.map(f => {
        const values = docs.map(d => ({
          src: d.source_type,
          val: d.stageA?.amounts?.[f.key] || '0',
          curr: d.stageA?.order?.currency || ''
        }));

        const isMismatch = values.some(v => v.val !== values[0]?.val);

        return \`
          <div onclick="jumpToAmountEvidence('\${f.key}')" class="card" style="padding: 8px 10px; cursor: pointer; border-color: \${isMismatch ? 'var(--mismatch)' : 'var(--border)'}; background-color: \${isMismatch ? 'var(--mismatch-bg)' : 'var(--surface)'};">
            <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 500; color: \${isMismatch ? 'var(--mismatch)' : 'var(--muted)'}; margin-bottom: 4px;">
              <span>\${f.label}</span>
              \${isMismatch ? '<span class="chip chip-mismatch" style="padding: 1px 4px; font-size: 9px;">Differs</span>' : ''}
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              \${values.map(v => \`
                <div style="display: flex; justify-content: space-between; font-size: 11px;">
                  <span style="color: var(--muted);">\${v.src}:</span>
                  <span class="mono tabular-nums" style="font-weight: 500;">\${v.curr ? v.curr + ' ' : ''}\${v.val}</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }).join('');
    }

    // Render Issues List (Plain English messages)
    function renderIssuesList(issues, docs) {
      const container = document.getElementById('issuesListContainer');
      document.getElementById('issueCountBadge').innerText = issues.length;

      if (!issues.length) {
        container.innerHTML = \`
          <div style="padding: 14px; text-align: center; color: var(--muted); font-size: 13px; background-color: var(--bg); border-radius: var(--radius-btn);">
            No discrepancies found. All extracted line items and order totals match across available sources.
          </div>
        \`;
        return;
      }

      container.innerHTML = issues.map((issue, idx) => {
        const isSelected = activeIssueIndex === idx;
        const englishMsg = formatPlainEnglishIssue(issue);
        const comparisonChips = renderIssueComparisonChips(issue);

        return \`
          <div id="issueCard_\${idx}" class="card" style="padding: 12px 14px; border-left: 3px solid var(--review); display: flex; align-items: center; justify-content: space-between; gap: 12px; background-color: \${isSelected ? 'var(--bg)' : 'var(--surface)'}; transition: all 120ms ease;">
            <div style="flex: 1; cursor: pointer;" onclick="inspectIssueByIndex(\${idx})">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                <span class="chip chip-review" style="font-size: 10px;">\${issue.issueType || 'DISCREPANCY'}</span>
                <span class="mono" style="font-size: 11px; color: var(--muted);">\${issue.normalizedSku || issue.field || '-'}</span>
              </div>
              <div style="font-size: 13px; font-weight: 500; color: var(--text);">
                \${escapeHtml(englishMsg)}
              </div>
              \${comparisonChips}
            </div>

            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              <button onclick="inspectIssueByIndex(\${idx})" class="btn-secondary btn-sm" title="View snippet in Source Viewer">
                Inspect
              </button>
              <button onclick="openReviewDrawerForIssue(\${idx})" class="btn-primary btn-sm" title="Record audit review decision">
                Review
              </button>
            </div>
          </div>
        \`;
      }).join('');
    }

    function getSourceNameForDocId(docId) {
      if (!currentCaseDetails?.documents) return docId;
      const d = currentCaseDetails.documents.find(doc => doc.id === docId);
      return d ? d.source_type : (docId.length > 8 ? docId.slice(0, 8) + '...' : docId);
    }

    // Render Side-by-Side Comparison Chips for Issue
    function renderIssueComparisonChips(issue) {
      if (!issue.candidateValues) return '';

      // Arithmetic / Line Total Mismatch
      if (issue.candidateValues.expected !== undefined && issue.candidateValues.actual !== undefined) {
        return \`
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11px;">
            <span class="mono" style="padding: 2px 6px; background-color: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--muted);">
              Stated: <strong style="color: var(--text);">\${escapeHtml(issue.candidateValues.actual)}</strong>
            </span>
            <span style="color: var(--muted); font-size: 10px;">vs</span>
            <span class="mono" style="padding: 2px 6px; background-color: var(--mismatch-bg); color: var(--mismatch); border: 1px solid rgba(220, 38, 38, 0.2); border-radius: 4px;">
              Computed: <strong>\${escapeHtml(issue.candidateValues.expected)}</strong>
            </span>
          </div>
        \`;
      }

      const entries = Object.entries(issue.candidateValues);
      if (entries.length >= 2) {
        return \`
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11px;">
            \${entries.map(([docId, val], i) => {
              const src = getSourceNameForDocId(docId);
              return \`
                \${i > 0 ? '<span style="color: var(--muted); font-size: 10px;">vs</span>' : ''}
                <span class="mono" style="padding: 2px 6px; background-color: \${src === 'JSON' ? 'var(--mismatch-bg)' : 'var(--bg)'}; color: \${src === 'JSON' ? 'var(--mismatch)' : 'var(--text)'}; border: 1px solid \${src === 'JSON' ? 'rgba(220,38,38,0.2)' : 'var(--border)'}; border-radius: 4px;">
                  \${src}: <strong style="font-weight: 600;">\${escapeHtml(val)}</strong>
                </span>
              \`;
            }).join('')}
          </div>
        \`;
      }
      return '';
    }

    // Plain English Issue Formatter
    function formatPlainEnglishIssue(issue) {
      if (issue.candidateValues) {
        if (issue.candidateValues.expected !== undefined && issue.candidateValues.actual !== undefined) {
          const expected = issue.candidateValues.expected;
          const actual = issue.candidateValues.actual;
          if (issue.issueType === 'LINE_TOTAL_MISMATCH') {
            return \`Line total arithmetic discrepancy in JSON: stated is \${actual}, but computed (12 × 50) is \${expected}\`;
          }
          return \`Discrepancy: expected \${expected}, stated \${actual}\`;
        }

        const entries = Object.entries(issue.candidateValues);
        if (entries.length >= 2) {
          const [idA, valA] = entries[0];
          const [idB, valB] = entries[1];
          const srcA = getSourceNameForDocId(idA);
          const srcB = getSourceNameForDocId(idB);
          if (issue.issueType === 'QUANTITY_MISMATCH') {
            return \`Quantity differs: \${valA} in the \${srcA}, \${valB} in the \${srcB}\`;
          }
          if (issue.issueType === 'PRICE_MISMATCH') {
            return \`Unit price differs: \${valA} in the \${srcA}, \${valB} in the \${srcB}\`;
          }
          if (issue.issueType === 'UOM_MISMATCH') {
            return \`Unit of measure differs: \${valA} in the \${srcA}, \${valB} in the \${srcB}\`;
          }
          return \`Field differs: \${valA} in \${srcA} vs \${valB} in \${srcB}\`;
        }
      }
      return issue.message || 'Value mismatch detected between documents';
    }

    // Switch Source Viewer Tabs (Email, PDF, JSON)
    function selectSourceTab(tabName) {
      activeSourceTab = tabName;
      ['Email', 'Pdf', 'Json'].forEach(t => {
        const btn = document.getElementById('tabBtn' + t);
        if (btn) {
          if (t.toUpperCase() === tabName) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        }
      });
      renderSourceViewerContent(tabName);
    }

    // Render Source Viewer Content
    function renderSourceViewerContent(tabName, targetHighlight) {
      const container = document.getElementById('sourceViewerBody');
      const metaSpan = document.getElementById('sourceViewerMeta');
      if (!currentCaseDetails) return;

      const doc = (currentCaseDetails.documents || []).find(d => d.source_type === tabName);

      if (!doc) {
        metaSpan.innerText = 'Document Not Attached';
        container.innerHTML = \`
          <div style="padding: 48px 16px; text-align: center; color: var(--muted);">
            <div style="font-weight: 500; font-size: 14px; margin-bottom: 4px;">\${tabName} Document Not Attached</div>
            <p style="font-size: 12px; margin-bottom: 16px;">This source is required to complete full three-way reconciliation.</p>
            <input type="file" id="directAttach_\${tabName}" style="display: none;" onchange="handleDirectDocumentUpload(event, '\${tabName}')" accept="\${tabName === 'PDF' ? '.pdf' : tabName === 'JSON' ? '.json' : '.eml,.txt'}">
            <button onclick="document.getElementById('directAttach_\${tabName}').click()" class="btn-primary btn-sm">Attach \${tabName} to this Case</button>
          </div>
        \`;
        return;
      }

      const lineCount = doc.stageA?.lineItems?.length ?? doc.lineItems?.length ?? 0;
      metaSpan.innerText = (doc.storage_path ? doc.storage_path.split('\\\\').pop() : 'Direct Ingestion') + ' • ' + lineCount + ' lines';

      // If document is JSON
      if (tabName === 'JSON') {
        let jsonText = '';
        if (doc.stageA) {
          jsonText = JSON.stringify(doc.stageA, null, 2);
        } else if (doc.rawText) {
          try {
            jsonText = JSON.stringify(JSON.parse(doc.rawText), null, 2);
          } catch {
            jsonText = doc.rawText;
          }
        } else {
          jsonText = 'No JSON content';
        }
        container.innerHTML = \`
          <pre class="mono" style="font-size: 11px; white-space: pre-wrap; word-break: break-all; color: var(--text);">\${escapeHtml(jsonText)}</pre>
        \`;
        return;
      }

      // For PDF / Email: render text with highlighted snippets
      const text = doc.cleanedText || doc.rawText || 'No text extracted';
      const evidenceList = doc.stageA?.evidence || [];

      let html = '<div class="mono" style="font-size: 12px; white-space: pre-wrap; word-break: break-word;">';

      // Split lines and render
      const lines = text.split('\\n');
      html += lines.map((line, lIdx) => {
        let isHighlighted = false;
        if (targetHighlight && line.toLowerCase().includes(targetHighlight.toLowerCase())) {
          isHighlighted = true;
        }

        return \`
          <div id="srcLine_\${lIdx}" class="\${isHighlighted ? 'evidence-highlight evidence-focus' : ''}" style="padding: 1px 4px; border-radius: 2px;">
            <span style="color: var(--muted); user-select: none; margin-right: 8px; font-size: 10px;">\${(lIdx + 1).toString().padStart(2, '0')}</span>\${escapeHtml(line)}
          </div>
        \`;
      }).join('');

      html += '</div>';
      container.innerHTML = html;

      // Scroll to highlight if present
      if (targetHighlight) {
        setTimeout(() => {
          const highlightedEl = container.querySelector('.evidence-highlight');
          if (highlightedEl) {
            highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }
    }

    // Jump to Evidence on Cell Click
    function jumpToEvidence(sourceType, snippetText) {
      selectSourceTab(sourceType);
      renderSourceViewerContent(sourceType, snippetText);
    }

    function jumpToAmountEvidence(amountKey) {
      selectSourceTab('PDF');
      renderSourceViewerContent('PDF', amountKey);
    }

    // Issue Keyboard / Click Highlight
    function highlightAndFocusIssue(idx) {
      const issues = currentCaseDetails?.latestResult?.issues || [];
      if (!issues[idx]) return;

      document.querySelectorAll('[id^="issueCard_"]').forEach((el, i) => {
        el.style.backgroundColor = i === idx ? 'var(--bg)' : 'var(--surface)';
      });

      const card = document.getElementById('issueCard_' + idx);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function inspectIssueByIndex(idx) {
      activeIssueIndex = idx;
      highlightAndFocusIssue(idx);
      const issues = currentCaseDetails?.latestResult?.issues || [];
      const issue = issues[idx];
      if (!issue) return;

      let targetSource = 'PDF';
      if (issue.issueType?.includes('JSON') || issue.issueType?.includes('LINE_TOTAL') || issue.message?.toLowerCase().includes('json')) {
        targetSource = 'JSON';
      } else if (issue.issueType?.includes('EMAIL') || issue.message?.toLowerCase().includes('email')) {
        targetSource = 'EMAIL';
      }

      const targetSnippet = issue.normalizedSku || (issue.field && issue.field.includes('.') ? issue.field.split('.').pop() : issue.field) || '';
      jumpToEvidence(targetSource, targetSnippet);
    }

    // Review Slide-over Drawer Handling
    function openReviewDrawerForActiveCase() {
      const issues = currentCaseDetails?.latestResult?.issues || [];
      if (issues.length > 0) {
        openReviewDrawerForIssue(0);
      } else {
        openReviewDrawerForIssue(-1);
      }
    }

    function openReviewDrawerForIssue(idx) {
      const issues = currentCaseDetails?.latestResult?.issues || [];
      const issue = idx >= 0 ? issues[idx] : null;
      currentActiveReviewIssue = issue;

      const drawer = document.getElementById('reviewDrawer');
      const backdrop = document.getElementById('drawerBackdrop');
      const msgEl = document.getElementById('drawerIssueMessage');
      const metaEl = document.getElementById('drawerIssueMeta');
      const candidatesContainer = document.getElementById('drawerCandidateValuesContainer');

      if (issue) {
        msgEl.innerText = formatPlainEnglishIssue(issue);
        metaEl.innerText = 'SKU: ' + (issue.normalizedSku || '-') + ' • Field: ' + (issue.field || '-');

        // Populate Candidate Radio Values
        const candidateEntries = Object.entries(issue.candidateValues || {});
        if (candidateEntries.length) {
          candidatesContainer.innerHTML = candidateEntries.map(([docId, val], optIdx) => \`
            <label style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-btn); cursor: pointer; background-color: var(--surface);">
              <input type="radio" name="winningVal" value="\${escapeHtml(val)}" \${optIdx === 0 ? 'checked' : ''} onchange="document.getElementById('drawerCustomValue').value = ''">
              <span class="mono" style="font-weight: 500;">\${escapeHtml(val)}</span>
              <span style="color: var(--muted); font-size: 11px; margin-left: auto;">(from doc \${docId.slice(0, 6)}...)</span>
            </label>
          \`).join('');
        } else {
          candidatesContainer.innerHTML = '<span style="font-size: 12px; color: var(--muted);">No candidate values extracted</span>';
        }

        // Fetch AI Root Cause & Recommendation Insight
        const aiBox = document.getElementById('drawerAiBox');
        const aiSummary = document.getElementById('drawerAiSummary');
        const aiRec = document.getElementById('drawerAiRecommendation');
        const aiBadge = document.getElementById('drawerAiModelBadge');

        if (aiBox && currentCase) {
          aiBox.style.display = 'block';
          aiSummary.innerHTML = '<em style="color: var(--muted);">Analyzing discrepancy with AI engine...</em>';
          aiRec.innerText = '';
          aiBadge.innerText = 'Analyzing...';

          fetch(\`/api/cases/\${currentCase.id}/ai-explain\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issueFingerprint: issue.fingerprint })
          })
            .then(r => r.json())
            .then(data => {
              const exp = data.explanations?.[0];
              if (exp && currentActiveReviewIssue?.fingerprint === issue.fingerprint) {
                aiSummary.innerText = exp.summary;
                aiRec.innerText = exp.recommendation;
                aiBadge.innerText = exp.isAiGenerated ? 'Gemini 2.5 Flash' : 'Rule Engine';
              }
            })
            .catch(() => {
              if (currentActiveReviewIssue?.fingerprint === issue.fingerprint) {
                aiBox.style.display = 'none';
              }
            });
        }
      } else {
        const aiBox = document.getElementById('drawerAiBox');
        if (aiBox) aiBox.style.display = 'none';
        msgEl.innerText = 'Manual Case Sign-Off';
        metaEl.innerText = 'PO: ' + (currentCaseDetails?.case?.po_number || '-');
        candidatesContainer.innerHTML = '<span style="font-size: 12px; color: var(--muted);">Sign-off and resolve current case.</span>';
      }

      drawer.classList.add('active');
      backdrop.classList.add('active');
    }

    function closeReviewDrawer() {
      document.getElementById('reviewDrawer').classList.remove('active');
      document.getElementById('drawerBackdrop').classList.remove('active');
      currentActiveReviewIssue = null;
    }

    // Submit Review Decision
    async function submitReviewDecision() {
      if (!currentCase) return;

      const selectedRadio = document.querySelector('input[name="winningVal"]:checked');
      const customVal = document.getElementById('drawerCustomValue').value.trim();
      const winningValue = customVal || (selectedRadio ? selectedRadio.value : '');
      const reviewer = document.getElementById('drawerReviewerName').value.trim();
      const reason = document.getElementById('drawerReason').value.trim();

      if (!winningValue) {
        alert('Please choose or enter a winning value.');
        return;
      }
      if (!reason) {
        alert('Please provide a business reason/justification.');
        return;
      }

      const submitBtn = document.getElementById('drawerSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.innerText = 'Submitting...';

      try {
        const payload = {
          issueFingerprint: currentActiveReviewIssue?.fingerprint || 'MANUAL_OVERRIDE_' + Date.now(),
          field: currentActiveReviewIssue?.field || 'order',
          lineReference: currentActiveReviewIssue?.lineReference || null,
          previousValue: null,
          selectedValue: winningValue,
          reason,
          reviewer,
          documentVersionIds: currentActiveReviewIssue?.docVersionIds || []
        };

        const res = await fetch(\`/api/cases/\${currentCase.id}/review\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Failed to submit review');
        }

        closeReviewDrawer();
        // Re-reconcile and refresh
        await runCaseReconciliation();
      } catch (err) {
        alert('Error recording decision: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Confirm Decision';
      }
    }

    // Run Reconciliation
    async function runCaseReconciliation() {
      if (!currentCase) return;
      const btn = document.getElementById('runReconBtn');
      btn.disabled = true;
      btn.innerText = 'Reconciling...';

      try {
        const res = await fetch(\`/api/cases/\${currentCase.id}/reconcile\`, {
          method: 'POST'
        });
        if (!res.ok) throw new Error('Reconciliation failed');
        await selectCase(currentCase.id);
        await loadAllData();
      } catch (err) {
        alert('Reconciliation error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>Run Reconciliation</span>';
      }
    }

    // Phase 3: Review Decisions History Viewer
    function renderReviewDecisionsHistory(decisions) {
      const container = document.getElementById('reviewDecisionsHistoryContainer');
      const badge = document.getElementById('decisionCountBadge');
      if (!container || !badge) return;

      badge.innerText = decisions.length;

      if (!decisions.length) {
        container.innerHTML = '<div style="color: var(--muted); font-size: 12px; font-style: italic;">No review decisions recorded for this case.</div>';
        return;
      }

      container.innerHTML = decisions.map(d => {
        const isSuperseded = !!d.superseded_by;
        const style = isSuperseded
          ? 'padding: 10px 12px; border: 1px dashed var(--border); border-radius: var(--radius-btn); background-color: var(--bg); opacity: 0.65;'
          : 'padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-btn); background-color: var(--surface);';

        const textStyle = isSuperseded ? 'text-decoration: line-through; color: var(--muted);' : 'color: var(--text); font-weight: 500;';

        return \`
          <div style="\${style}">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="chip \${isSuperseded ? 'chip-mismatch' : 'chip-match'}" style="font-size: 10px;">
                  \${isSuperseded ? 'SUPERSEDED' : 'ACTIVE'}
                </span>
                <span class="mono" style="font-size: 11px; font-weight: 600;">\${escapeHtml(d.field || '')}</span>
              </div>
              <span style="font-size: 11px; color: var(--muted);">\${d.created_at ? new Date(d.created_at).toLocaleString() : ''}</span>
            </div>
            <div style="font-size: 12px; \${textStyle} margin-bottom: 4px;">
              Approved Value: <strong class="mono" style="color: \${isSuperseded ? 'var(--muted)' : 'var(--accent)'};">\${escapeHtml(d.selected_value || '')}</strong>
              \${d.previous_value ? \`<span style="font-size: 11px; color: var(--muted); text-decoration: none;"> (Previous: \${escapeHtml(d.previous_value)})</span>\` : ''}
            </div>
            <div style="font-size: 11px; color: var(--muted); display: flex; align-items: center; justify-content: space-between;">
              <span>By: <strong style="color: var(--text);">\${escapeHtml(d.reviewer || 'Ops')}</strong> — "\${escapeHtml(d.reason || '')}"</span>
              \${isSuperseded ? \`<span class="mono" style="font-size: 10px; color: var(--mismatch);">superseded_by: \${escapeHtml(d.superseded_by)}</span>\` : ''}
            </div>
          </div>
        \`;
      }).join('');
    }

    // Phase 3: Case Audit Trail Drawer
    async function openAuditDrawerForActiveCase() {
      if (!currentCase) return;
      const drawer = document.getElementById('auditDrawer');
      const backdrop = document.getElementById('auditDrawerBackdrop');
      const container = document.getElementById('auditTimelineContainer');

      drawer.classList.add('active');
      backdrop.classList.add('active');
      container.innerHTML = '<div style="color: var(--muted); font-size: 12px; text-align: center; padding: 20px;">Fetching audit history...</div>';

      try {
        const res = await fetch(\`/api/cases/\${currentCase.id}/audit\`);
        if (!res.ok) throw new Error('Failed to load audit history');
        const data = await res.json();
        const logs = data.auditLogs || [];

        if (!logs.length) {
          container.innerHTML = '<div style="color: var(--muted); font-size: 12px; text-align: center; padding: 20px;">No audit events recorded for this case.</div>';
          return;
        }

        container.innerHTML = logs.map(log => {
          const action = log.action || 'EVENT';
          let chipClass = 'chip-open';
          if (action.includes('RECONCILE') || action.includes('MATCH')) chipClass = 'chip-match';
          else if (action.includes('REVIEW')) chipClass = 'chip-review';
          else if (action.includes('LINK') || action.includes('DOC')) chipClass = 'chip-open';

          const formattedTime = log.created_at ? new Date(log.created_at).toLocaleString() : '';
          const detailsStr = typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : log.details;

          return \`
            <div class="card" style="padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; border-left: 3px solid var(--accent);">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span class="chip \${chipClass}" style="font-size: 10px;">\${escapeHtml(action)}</span>
                <span style="font-size: 11px; color: var(--muted);">\${escapeHtml(formattedTime)}</span>
              </div>
              <div style="font-size: 12px; color: var(--text);">
                Entity: <strong class="mono" style="font-size: 11px;">\${escapeHtml(log.entity_type)}</strong> (\${escapeHtml(log.entity_id)})
                • By: <strong style="color: var(--muted);">\${escapeHtml(log.performed_by || 'SYSTEM')}</strong>
              </div>
              \${detailsStr ? \`
                <pre class="mono" style="font-size: 11px; padding: 6px 8px; background-color: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-btn); overflow-x: auto; white-space: pre-wrap; margin: 0; color: var(--muted);">\${escapeHtml(detailsStr)}</pre>
              \` : ''}
            </div>
          \`;
        }).join('');
      } catch (err) {
        container.innerHTML = \`<div style="color: var(--mismatch); font-size: 12px; text-align: center; padding: 20px;">Error: \${escapeHtml(err.message)}</div>\`;
      }
    }

    function closeAuditDrawer() {
      document.getElementById('auditDrawer')?.classList.remove('active');
      document.getElementById('auditDrawerBackdrop')?.classList.remove('active');
    }

    // Upload & Ingestion Drop Zone Slots Handling
    function handleFilePicked(sourceType, file) {
      if (!file) return;
      uploadedSlots[sourceType] = file;

      const slot = document.getElementById('slot' + sourceType.charAt(0) + sourceType.slice(1).toLowerCase());
      const statusText = document.getElementById('slot' + sourceType.charAt(0) + sourceType.slice(1).toLowerCase() + 'Status');
      const checkEl = document.getElementById('slot' + sourceType.charAt(0) + sourceType.slice(1).toLowerCase() + 'Check');

      slot.classList.add('ready');
      statusText.innerText = file.name;
      checkEl.style.display = 'block';

      // Check if at least one file is ready
      const hasAny = Object.values(uploadedSlots).some(f => f !== null);
      document.getElementById('startUploadBtn').disabled = !hasAny;
    }

    function resetUploadSlots() {
      uploadedSlots = { EMAIL: null, PDF: null, JSON: null };
      ['Email', 'Pdf', 'Json'].forEach(t => {
        const slot = document.getElementById('slot' + t);
        const statusText = document.getElementById('slot' + t + 'Status');
        const checkEl = document.getElementById('slot' + t + 'Check');
        slot.classList.remove('ready');
        statusText.innerText = 'Drop .' + t.toLowerCase();
        checkEl.style.display = 'none';
      });
      document.getElementById('startUploadBtn').disabled = true;
    }

    // Direct Single-Document Upload to Current Case
    async function handleDirectDocumentUpload(event, srcType) {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!currentCase) {
        alert('Please select or open a case before attaching documents directly, or use the "Upload Documents" tab.');
        return;
      }

      const metaSpan = document.getElementById('sourceViewerMeta');
      if (metaSpan) metaSpan.innerText = 'Uploading ' + file.name + '...';

      const formData = new FormData();
      formData.append('file', file);
      formData.append('sourceType', srcType);
      formData.append('caseId', currentCase.id);
      if (currentCase.po_number) formData.append('poNumber', currentCase.po_number);
      if (currentCase.customer_id) formData.append('customerId', currentCase.customer_id);

      try {
        const res = await fetch('/api/documents', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Upload failed');
        }
        if (data.status === 'DUPLICATE_FILE') {
          alert('Notice: This exact file was already attached previously (duplicate SHA-256 hash).');
        }
        await selectCase(currentCase.id);
        await runCaseReconciliation();
      } catch (err) {
        alert('Failed attaching document: ' + err.message);
        renderSourceViewerContent(srcType);
      }
    }

    async function submitUploadedDocuments() {
      const btn = document.getElementById('startUploadBtn');
      btn.disabled = true;
      btn.innerText = 'Uploading & Ingesting (OCR may take a few seconds)...';

      const po = document.getElementById('uploadPoNumber').value.trim();
      const cust = document.getElementById('uploadCustomerId').value.trim();

      try {
        const uploadPromises = [];
        for (const [srcType, file] of Object.entries(uploadedSlots)) {
          if (file) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('sourceType', srcType);
            if (po) formData.append('poNumber', po);
            if (cust) formData.append('customerId', cust);
            if (currentCase) formData.append('caseId', currentCase.id);

            uploadPromises.push(
              fetch('/api/documents', {
                method: 'POST',
                body: formData
              }).then(async r => {
                const json = await r.json();
                if (!r.ok) {
                  throw new Error(json.error || 'Upload failed');
                }
                return json;
              })
            );
          }
        }

        const results = await Promise.all(uploadPromises);
        resetUploadSlots();
        await loadAllData();

        // Check if any results were flagged as duplicates or sent to unlinked
        const duplicateResults = results.filter(r => r.status === 'DUPLICATE_FILE');
        const unlinkedResults = results.filter(r => r.routedToQueue === 'UNLINKED');

        if (unlinkedResults.length > 0) {
          alert('Document ingested! It was placed in the "Unlinked Docs" queue because customer ID could not be matched automatically. You can assign it to a PO now.');
          switchMainView('unlinked');
          return;
        }

        if (duplicateResults.length > 0 && results.every(r => r.status === 'DUPLICATE_FILE')) {
          alert('Notice: This file was already ingested previously (duplicate SHA-256 hash). Navigating to the existing case.');
        }

        // Switch to the first newly linked, created, or resolved case
        const targetCaseId = results[0]?.caseId || results[0]?.stageA?.order?.poNumber;
        if (targetCaseId) {
          const matchCase = allCases.find(c => c.id === targetCaseId || c.po_number === targetCaseId);
          if (matchCase) {
            await selectCase(matchCase.id);
            await runCaseReconciliation();
          } else {
            switchMainView('cases');
          }
        } else {
          switchMainView('cases');
          if (allCases.length > 0) {
            await selectCase(allCases[0].id);
            await runCaseReconciliation();
          }
        }
      } catch (err) {
        alert('Failed uploading files: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Process & Reconcile';
      }
    }

    // Render Review Queues
    function renderQueues(queues) {
      const tbody = document.getElementById('queuesTableBody');
      if (!queues.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--muted);">No queued items requiring resolution.</td></tr>';
        return;
      }

      tbody.innerHTML = queues.map(q => \`
        <tr>
          <td class="mono" style="font-weight: 500;">\${q.id.slice(0, 8)}...</td>
          <td><span class="chip chip-review">\${q.queue_type}</span></td>
          <td class="mono">\${q.document_id ? q.document_id.slice(0, 8) + '...' : '-'}</td>
          <td style="color: var(--muted); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            \${escapeHtml(q.payload_json || '')}
          </td>
          <td style="font-size: 11px; color: var(--muted);">\${q.created_at ? q.created_at.slice(0, 16) : '-'}</td>
          <td style="text-align: right;">
            <button onclick="resolveQueueItem('\${q.id}')" class="btn-primary btn-sm">Resolve</button>
          </td>
        </tr>
      \`).join('');
    }

    function renderUnlinked(unlinkedItems) {
      const tbody = document.getElementById('unlinkedTableBody');
      if (!unlinkedItems.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--muted);">No unlinked documents.</td></tr>';
        return;
      }

      tbody.innerHTML = unlinkedItems.map(item => \`
        <tr>
          <td class="mono">\${item.document_id ? item.document_id.slice(0, 8) + '...' : item.id.slice(0, 8)}</td>
          <td><span class="chip chip-open">\${item.queue_type}</span></td>
          <td style="color: var(--muted);">Incoming Document</td>
          <td class="mono">-</td>
          <td><span class="chip chip-review">Pending Link</span></td>
          <td style="text-align: right;">
            <button onclick="switchMainView('cases')" class="btn-secondary btn-sm">Assign PO</button>
          </td>
        </tr>
      \`).join('');
    }

    async function resolveQueueItem(queueId) {
      const reason = prompt('Resolution reason:');
      if (!reason) return;
      try {
        const res = await fetch(\`/api/queues/\${queueId}/resolve\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolvedBy: 'Operations', reason })
        });
        if (res.ok) {
          loadAllData();
        }
      } catch (err) {
        alert('Resolution failed: ' + err.message);
      }
    }

    async function checkDeadlinesNow() {
      try {
        const res = await fetch('/api/cases/check-deadlines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ now: new Date().toISOString() })
        });
        const data = await res.json();
        alert('Deadline evaluation complete. Cases evaluated: ' + (data.summary?.evaluated || 0));
        loadAllData();
      } catch (err) {
        alert('Deadline check failed: ' + err.message);
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  </script>
</body>
</html>
`;
}
