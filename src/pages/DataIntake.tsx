import { useState, useRef, useEffect, useCallback } from 'react';
import { UPLOADED_FILES, OCR_PREVIEW, FACILITIES } from '../data/mockData';

const INTEGRATIONS = [
  { name: 'QuickBooks Online', status: 'not-connected' as const, icon: '📊' },
  { name: 'Xero', status: 'not-connected' as const, icon: '📋' },
  { name: 'UPS', status: 'connected' as const, icon: '🟤' },
  { name: 'FedEx', status: 'connected' as const, icon: '🟣' },
];

type ActionStatus = { type: 'success' | 'error'; message: string } | null;

export default function DataIntake() {
  const [selectedFile, setSelectedFile] = useState<number | null>(1);
  const [activeTab, setActiveTab] = useState<'files' | 'integrations' | 'review'>('files');
  const [actionStatus, setActionStatus] = useState<ActionStatus>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const showStatus = useCallback((type: 'success' | 'error', message: string) => {
    setActionStatus({ type, message });
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setActionStatus(null), 4000);
  }, []);

  const handleApprove = async () => {
    if (selectedFile === null) return;
    setIsProcessing(true);
    try {
      // TODO: Replace with insforge.db.insert([{ ...extractedFields }]) when backend is wired.
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      showStatus('success', 'Record approved and added to the emissions ledger.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve record. Please try again.';
      showStatus('error', msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRequestReview = async () => {
    if (selectedFile === null) return;
    setIsProcessing(true);
    try {
      // TODO: Replace with insforge.db.update() to flag record for human review.
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      showStatus('success', 'Record flagged for human review.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to flag record. Please try again.';
      showStatus('error', msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEditFields = () => {
    // TODO: Open an edit modal/drawer wired to the selected OCR record.
    showStatus('success', 'Edit mode coming soon — fields will be editable inline.');
  };

  const handleUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // TODO: Replace with insforge.storage.upload() for each file.
    showStatus('success', `${files.length} file(s) queued for processing.`);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,.xlsx,.pdf,.png,.jpg"
        className="sr-only"
        aria-label="Select files to upload"
        onChange={(e) => handleUpload(e.target.files)}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Data Intake</h1>
          <p className="text-sm text-surface-500 mt-0.5">Upload, connect, and review emissions data sources</p>
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary">
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" strokeLinecap="round"/></svg>
          Upload Files
        </button>
      </div>

      {/* Action status banner */}
      {actionStatus && (
        <div
          role="status"
          aria-live="polite"
          className={`px-4 py-2.5 rounded-lg text-sm border ${
            actionStatus.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}
        >
          {actionStatus.message}
        </div>
      )}

      <div role="tablist" aria-label="Data intake sections" className="flex gap-2 border-b border-surface-200 dark:border-surface-700">
        {(['files', 'integrations', 'review'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tab-panel-${tab}`}
            id={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
          >
            {tab === 'review' ? 'Human Review Queue' : tab === 'integrations' ? 'Integrations' : 'Uploaded Files'}
          </button>
        ))}
      </div>

      {activeTab === 'files' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
              <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300">Uploaded Files</h3>
            </div>
            <div className="divide-y divide-surface-100 dark:divide-surface-800">
              {UPLOADED_FILES.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  aria-pressed={selectedFile === file.id}
                  aria-label={`Select file: ${file.name}`}
                  onClick={() => setSelectedFile(file.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors ${selectedFile === file.id ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-8 h-8 rounded flex items-center justify-center text-xs ${
                      file.type === 'utility' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                      file.type === 'freight' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                      file.type === 'supplier' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                      'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-400'
                    }`}>
                      {file.type === 'utility' ? '⚡' : file.type === 'freight' ? '🚛' : file.type === 'supplier' ? '📦' : '📄'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{file.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xs text-surface-400">{file.date}</span>
                        <span className={`badge ${
                          file.status === 'extracted' ? 'badge-green' :
                          file.status === 'review' ? 'badge-amber' : 'badge-gray'
                        }`}>
                          {file.status === 'extracted' ? 'Extracted' : file.status === 'review' ? 'Needs Review' : 'Estimated'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs font-medium ${file.confidence >= 85 ? 'text-risk-low' : file.confidence >= 60 ? 'text-risk-medium' : 'text-risk-high'}`}>
                        {file.confidence}%
                      </div>
                      <div className="text-2xs text-surface-400">confidence</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3 card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium text-surface-800 dark:text-surface-200">OCR Extraction Preview</h3>
                <p className="text-2xs text-surface-500 mt-0.5">{OCR_PREVIEW.fileName}</p>
              </div>
              <div className="flex gap-2">
                <span className="badge-green">96% confidence</span>
                <span className="badge-blue">12 fields</span>
              </div>
            </div>
            <div className="space-y-2">
              {OCR_PREVIEW.extractedFields.map((field, i) => (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <div className="w-36 text-xs text-surface-500 flex-shrink-0">{field.label}</div>
                  <div className="flex-1 text-sm font-medium text-surface-800 dark:text-surface-200">{field.value}</div>
                  <div className={`text-xs font-medium ${field.confidence >= 90 ? 'text-risk-low' : field.confidence >= 70 ? 'text-risk-medium' : 'text-risk-high'}`}>
                    {field.confidence}%
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4 pt-4 border-t border-surface-200 dark:border-surface-700">
              <button
                type="button"
                disabled={isProcessing || selectedFile === null}
                onClick={() => void handleApprove()}
                className="btn-primary text-xs"
              >
                {isProcessing ? 'Processing…' : 'Approve & Add to Ledger'}
              </button>
              <button
                type="button"
                disabled={isProcessing || selectedFile === null}
                onClick={() => void handleRequestReview()}
                className="btn-secondary text-xs"
              >
                Request Human Review
              </button>
              <button
                type="button"
                disabled={selectedFile === null}
                onClick={handleEditFields}
                className="btn-ghost text-xs"
              >
                Edit Fields
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Accounting Systems</h3>
            <div className="space-y-3">
              {INTEGRATIONS.filter(i => ['QuickBooks Online', 'Xero'].includes(i.name)).map((int) => (
                <div key={int.name} className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{int.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{int.name}</div>
                      <div className="text-2xs text-surface-500">Import utility bills and expense data</div>
                    </div>
                  </div>
                  <button type="button" className="btn-secondary text-xs">{int.status === 'connected' ? 'Connected' : 'Connect'}</button>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Shipping & Freight</h3>
            <div className="space-y-3">
              {INTEGRATIONS.filter(i => ['UPS', 'FedEx'].includes(i.name)).map((int) => (
                <div key={int.name} className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{int.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{int.name}</div>
                      <div className="text-2xs text-surface-500">Import shipment data for freight emissions</div>
                    </div>
                  </div>
                  <button type="button" className={int.status === 'connected' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>{int.status === 'connected' ? 'Connected' : 'Connect'}</button>
                </div>
              ))}
            </div>
          </div>

          <div className="card md:col-span-2">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Facility Connections</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {FACILITIES.map((f) => (
                <div key={f.id} className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{f.name}</div>
                  <div className="text-2xs text-surface-500">{f.city} · {f.type}</div>
                  <div className="flex gap-1.5 mt-2">
                    <span className="badge-green text-2xs">Electricity</span>
                    <span className="badge-blue text-2xs">Gas</span>
                    {f.scope1Pct > 35 && <span className="badge-amber text-2xs">Refrigerants</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'review' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Human Review Queue</h3>
            <span className="badge-amber">12 records pending</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700">
                  <th className="pb-2 font-medium">Record</th>
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 font-medium">Scope</th>
                  <th className="pb-2 font-medium">Confidence</th>
                  <th className="pb-2 font-medium">Issue</th>
                  <th className="pb-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                {[
                  { id: 'REV-001', source: 'FedEx_freight_report_Q1.csv', scope: 'Scope 3', confidence: 72, issue: 'Multiple shipments missing weight data' },
                  { id: 'REV-002', source: 'UPS_shipment_log_Q1.csv', scope: 'Scope 3', confidence: 68, issue: 'Origin/destination pair unclear for 4 lanes' },
                  { id: 'REV-003', source: 'Ingredient_list_estimates.xlsx', scope: 'Scope 3', confidence: 44, issue: 'Spend-based estimate applied — no primary data' },
                  { id: 'REV-004', source: 'Refrigerant service log', scope: 'Scope 1', confidence: 71, issue: 'Leak rate assumes 3% industry average' },
                ].map((r) => (
                  <tr key={r.id} className="text-surface-700 dark:text-surface-300">
                    <td className="py-2.5 font-medium text-surface-800 dark:text-surface-200">{r.id}</td>
                    <td className="py-2.5 text-xs">{r.source}</td>
                    <td className="py-2.5"><span className="badge-blue">{r.scope}</span></td>
                    <td className="py-2.5"><span className={`font-medium ${r.confidence >= 85 ? 'text-risk-low' : r.confidence >= 60 ? 'text-risk-medium' : 'text-risk-high'}`}>{r.confidence}%</span></td>
                    <td className="py-2.5 text-xs">{r.issue}</td>
                    <td className="py-2.5"><button type="button" className="btn-ghost text-xs">Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}