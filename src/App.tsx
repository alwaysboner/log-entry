import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Sparkles, Settings, Image as ImageIcon, 
  RefreshCw, X, AlertTriangle, Info, HelpCircle, BookOpen,
  ChevronRight, ChevronLeft, Sliders, Wand2, Layers, Cpu,
  Copy, Check, ExternalLink, HelpCircle as HelpIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateConfig, GenerationConfig } from './lib/gemini';
import { embedPngMetadata, formatParameters, readPngMetadata, parseParameters } from './lib/metadata';
import { cn } from './lib/utils';

const MetadataInspector = ({ file, metadata, chunks }: { file: File | null, metadata: string | null, chunks: string[] }) => {
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    if (!file) {
      setError(null);
      return;
    }
    if (!metadata && chunks.length > 0) {
      setError("No 'parameters' metadata found, but chunks were detected.");
    } else if (!metadata) {
      setError("No metadata found.");
    } else {
      setError(null);
    }
  }, [file, metadata, chunks]);

  if (!file) return null;

  return (
    <div className="mt-4 p-4 bg-black/60 border border-neutral-800 rounded-2xl space-y-3 max-h-[450px] flex flex-col shadow-2xl backdrop-blur-md overflow-hidden">
      <div className="flex items-center justify-between shrink-0 pb-2 border-b border-neutral-800/50">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-emerald-500/20 rounded">
            <Info className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <h3 className="text-[11px] font-bold uppercase text-neutral-300 tracking-wider">Metadata Inspector</h3>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowDebug(!showDebug)}
            className={cn(
              "text-[9px] font-bold uppercase px-2 py-1 rounded transition-colors",
              showDebug ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-neutral-500 hover:text-neutral-300"
            )}
          >
            {showDebug ? 'Hide Chunks' : 'Show Chunks'}
          </button>
          <span className="text-[9px] text-neutral-600 font-mono truncate max-w-[120px]">{file.name}</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 min-h-0">
        {showDebug && chunks.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1 p-2 bg-black/40 rounded-xl border border-neutral-800/50">
              {chunks.map((c, i) => (
                <span key={i} className="text-[8px] font-mono px-1.5 py-0.5 bg-neutral-900 text-neutral-500 rounded border border-neutral-800">
                  {c}
                </span>
              ))}
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(chunks.join(', '));
              }}
              className="text-[9px] font-bold uppercase text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1.5 ml-1"
            >
              <Copy className="w-2.5 h-2.5" />
              Copy Chunk List
            </button>
          </div>
        )}
        
        {error ? (
          <div className="flex items-center gap-2 text-amber-500/80 text-[10px] italic bg-amber-500/5 p-3 rounded-xl border border-amber-500/10">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {error}
          </div>
        ) : metadata ? (
          <div className="relative group">
            <pre className="text-[10px] font-mono text-neutral-400 whitespace-pre-wrap break-all bg-black/40 p-4 rounded-xl border border-neutral-800/50 leading-relaxed">
              {metadata}
            </pre>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(metadata);
                alert('Metadata copied to clipboard');
              }}
              className="absolute top-3 right-3 p-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-black/80"
              title="Copy Metadata"
            >
              <Copy className="w-3.5 h-3.5 text-neutral-300" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-neutral-600 gap-2">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Scanning...</span>
          </div>
        )}
      </div>
    </div>
  );
};

function App() {
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [userVision, setUserVision] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [config, setConfig] = useState<GenerationConfig | null>(null);
  const [manualConfig, setManualConfig] = useState<any>(null);
  const [isProcessingDownload, setIsProcessingDownload] = useState(false);
  const [existingMetadata, setExistingMetadata] = useState<string | null>(null);
  const [foundChunks, setFoundChunks] = useState<string[]>([]);
  const [showMetadataAlert, setShowMetadataAlert] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedType, setCopiedType] = useState<'positive' | 'negative' | null>(null);
  const [showModelGuide, setShowModelGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<'params' | 'insights' | 'next'>('params');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            await processFile(blob as File);
          }
          break;
        } else if (items[i].type === 'text/plain') {
          items[i].getAsString(async (text) => {
            const trimmedText = text.trim();
            if (trimmedText.startsWith('data:image/') && trimmedText.includes('base64,')) {
              console.log('Pasted base64 detected');
              try {
                const parts = trimmedText.split(',');
                const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
                const bstr = atob(parts[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                  u8arr[n] = bstr.charCodeAt(n);
                }
                const file = new File([u8arr], "pasted-image.png", { type: mime });
                await processFile(file);
              } catch (err) {
                console.error('Failed to process pasted base64 manually:', err);
                try {
                  const response = await fetch(trimmedText);
                  const blob = await response.blob();
                  const file = new File([blob], "pasted-image.png", { type: blob.type });
                  await processFile(file);
                } catch (fetchErr) {
                  console.error('Fetch fallback also failed:', fetchErr);
                }
              }
            }
          });
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    console.log('Processing file:', file.name, file.type, file.size);
    try {
      setImage(file);
      
      // Use URL.createObjectURL for better performance and mobile stability
      const url = URL.createObjectURL(file);
      setImagePreview(url);
      
      setConfig(null);
      setManualConfig(null);
      
      const metadataResult = await readPngMetadata(file);
      const metadata = metadataResult?.text || null;
      setFoundChunks(metadataResult?.chunks || []);
      console.log('Metadata found:', !!metadata);
      
      // Get image dimensions
      const img = new Image();
      img.src = url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load image for dimensions'));
      });
      
      if (metadata) {
        setExistingMetadata(metadata);
        setShowMetadataAlert(true);
        const parsed = parseParameters(metadata);
        setManualConfig({
          ...parsed,
          width: img.width,
          height: img.height
        });
      } else {
        setExistingMetadata(null);
        setShowMetadataAlert(false);
        setManualConfig({
          width: img.width,
          height: img.height
        });
      }
    } catch (error) {
      console.error('Error processing file:', error);
      alert('Failed to process image file. Check console for details.');
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await processFile(file);
    }
  };

  const handleGenerate = async () => {
    if (!imagePreview || !userVision) return;
    setIsGenerating(true);
    try {
      // We need base64 for Gemini, but we'll keep the object URL for the UI
      const response = await fetch(imagePreview);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      const base64Data = await base64Promise;
      
      const newConfig = await generateConfig(base64Data, userVision, existingMetadata || undefined);
      setConfig(newConfig);
      setManualConfig((prev: any) => ({
        ...newConfig,
        width: prev?.width,
        height: prev?.height
      }));
      setActiveTab('insights');
    } catch (error) {
      console.error(error);
      alert('Failed to generate configuration.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!image || !manualConfig || !imagePreview) return;
    setIsProcessingDownload(true);
    try {
      let blob: Blob;

      // If the original image is a PNG, we use it directly to preserve all non-conflicting chunks
      // (like color profiles, physical dimensions, etc.)
      if (image.type === 'image/png') {
        const arrayBuffer = await image.arrayBuffer();
        blob = new Blob([arrayBuffer], { type: 'image/png' });
      } else {
        // Fallback to canvas for non-PNGs (converting them to PNG)
        const img = new Image();
        img.src = imagePreview;
        await new Promise((resolve) => (img.onload = resolve));
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');
        ctx.drawImage(img, 0, 0);
        
        blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('Canvas conversion failed'));
          }, 'image/png');
        });
      }
      
      // manualConfig now contains width/height from processFile
      const paramString = formatParameters(manualConfig);
      
      // Construct AI Tips string for Description metadata
      let aiTips = "";
      if (manualConfig.dynamicInsights && manualConfig.dynamicInsights.length > 0) {
        aiTips += "Dynamic Insights:\n";
        manualConfig.dynamicInsights.forEach((insight: any) => {
          aiTips += `- ${insight.topic}: ${insight.insight}\n`;
        });
        aiTips += "\n";
      }
      if (manualConfig.postProcessingTips && manualConfig.postProcessingTips.length > 0) {
        aiTips += "Post-Processing Tips:\n";
        manualConfig.postProcessingTips.forEach((tip: string) => {
          aiTips += `- ${tip}\n`;
        });
      }

      const newBlob = await embedPngMetadata(blob, paramString, aiTips.trim());
      
      const url = URL.createObjectURL(newBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drawthings-config-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to process image.');
    } finally {
      setIsProcessingDownload(false);
    }
  };

  const copyToClipboard = (text: string, type: 'positive' | 'negative') => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  return (
    <div className="flex h-[100dvh] bg-[#0f0f0f] text-[#e0e0e0] font-sans overflow-hidden">
      
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        className="hidden"
      />

      {/* Left Sidebar: Parameters & Vision */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 340 : 0, opacity: sidebarOpen ? 1 : 0 }}
        className="relative flex flex-col bg-[#1a1a1a] border-r border-[#2a2a2a] z-20"
      >
        <div className="flex flex-col h-full w-[340px]">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-[#2a2a2a] flex items-center justify-between bg-[#1a1a1a]">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/20 rounded-lg">
                <Sliders className="w-4 h-4 text-indigo-400" />
              </div>
              <span className="font-bold text-sm tracking-tight uppercase">Parameters</span>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setShowModelGuide(true)}
                className="p-1.5 hover:bg-white/5 rounded text-neutral-500 hover:text-neutral-300 transition-colors"
                title="Model Guide"
              >
                <HelpIcon className="w-4 h-4" />
              </button>
              <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-white/5 rounded text-neutral-500 hover:text-neutral-300">
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
            
            {/* Vision Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest">Vision Input</label>
                <Wand2 className="w-3 h-3 text-indigo-500" />
              </div>
              <textarea
                value={userVision}
                onChange={(e) => setUserVision(e.target.value)}
                placeholder="Describe your vision (e.g., 'Make it look like a van gogh painting with thick brushstrokes')..."
                className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all resize-none h-32"
              />
              <button
                onClick={handleGenerate}
                disabled={!imagePreview || !userVision || isGenerating}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all",
                  !imagePreview || !userVision || isGenerating
                    ? "bg-[#2a2a2a] text-neutral-600 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/10"
                )}
              >
                {isGenerating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {isGenerating ? 'Analyzing...' : 'Generate Config'}
              </button>
            </div>

            {/* Config View (Mimicking Draw Things Sliders) */}
            {(manualConfig || config) && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                className="space-y-6 pt-4 border-t border-[#2a2a2a]"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest">Generation Settings</label>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => setActiveTab('params')}
                        className={cn(
                          "px-2 py-1 rounded text-[9px] font-bold uppercase tracking-tighter transition-colors",
                          activeTab === 'params' ? "bg-indigo-500 text-white" : "bg-[#0f0f0f] text-neutral-500 hover:text-neutral-300"
                        )}
                      >
                        Params
                      </button>
                      <button 
                        onClick={() => setActiveTab('insights')}
                        className={cn(
                          "px-2 py-1 rounded text-[9px] font-bold uppercase tracking-tighter transition-colors",
                          activeTab === 'insights' ? "bg-indigo-500 text-white" : "bg-[#0f0f0f] text-neutral-500 hover:text-neutral-300"
                        )}
                      >
                        Insights
                      </button>
                      <button 
                        onClick={() => setActiveTab('next')}
                        className={cn(
                          "px-2 py-1 rounded text-[9px] font-bold uppercase tracking-tighter transition-colors",
                          activeTab === 'next' ? "bg-indigo-500 text-white" : "bg-[#0f0f0f] text-neutral-500 hover:text-neutral-300"
                        )}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                  
                  {activeTab === 'params' ? (
                    <div className="space-y-4">
                      <DrawThingsSlider 
                        label="Steps" 
                        value={manualConfig?.steps ?? config?.steps ?? 20} 
                        max={100} 
                        onChange={(v) => setManualConfig((prev: any) => ({ ...prev, steps: v }))}
                      />
                      <DrawThingsSlider 
                        label="CFG Scale" 
                        value={manualConfig?.cfgScale ?? config?.cfgScale ?? 7.5} 
                        max={30} 
                        step={0.1}
                        onChange={(v) => setManualConfig((prev: any) => ({ ...prev, cfgScale: v }))}
                      />
                      <DrawThingsSlider 
                        label="Denoising" 
                        value={manualConfig?.denoisingStrength ?? config?.denoisingStrength ?? 0.5} 
                        max={1} 
                        step={0.01} 
                        onChange={(v) => setManualConfig((prev: any) => ({ ...prev, denoisingStrength: v }))}
                      />
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <span className="text-[10px] text-neutral-500 font-bold uppercase">Sampler</span>
                          <select 
                            value={manualConfig?.sampler ?? config?.sampler ?? 'Euler a'}
                            onChange={(e) => setManualConfig((prev: any) => ({ ...prev, sampler: e.target.value }))}
                            className="w-full bg-[#0f0f0f] border border-[#2a2a2a] p-2 rounded-lg text-[10px] font-mono text-neutral-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                          >
                            {['Euler a', 'DPM++ 2M Karras', 'DPM++ SDE Karras', 'DDIM', 'DDIM Trailing', 'Heun'].map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1.5 relative group">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-neutral-500 font-bold uppercase">Model</span>
                            {manualConfig?.model && manualConfig.model !== config?.model && (
                              <button
                                onClick={async () => {
                                  if (!image || !userVision || isGenerating) return;
                                  setIsGenerating(true);
                                  try {
                                    const newConfig = await generateConfig(
                                      await new Promise<string>((resolve) => {
                                        const reader = new FileReader();
                                        reader.onload = (e) => resolve(e.target?.result as string);
                                        reader.readAsDataURL(image);
                                      }),
                                      userVision,
                                      existingMetadata || undefined,
                                      manualConfig.model
                                    );
                                    setConfig(newConfig);
                                    setManualConfig(null); // Reset manual overrides as we have a new base config
                                  } catch (e) {
                                    console.error(e);
                                  } finally {
                                    setIsGenerating(false);
                                  }
                                }}
                                disabled={isGenerating}
                                className={cn(
                                  "text-[9px] font-bold uppercase flex items-center gap-1 transition-colors",
                                  isGenerating 
                                    ? "text-neutral-600 animate-pulse" 
                                    : "text-indigo-400 hover:text-indigo-300"
                                )}
                              >
                                {isGenerating ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                                {isGenerating ? 'Optimizing...' : 'Optimize'}
                              </button>
                            )}
                          </div>
                          <select 
                            value={manualConfig?.model ?? config?.model ?? 'v1.5'}
                            onChange={(e) => setManualConfig((prev: any) => ({ ...prev, model: e.target.value }))}
                            className="w-full bg-[#0f0f0f] border border-[#2a2a2a] p-2 rounded-lg text-[10px] font-mono text-neutral-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                          >
                            {(() => {
                              const currentModel = manualConfig?.model ?? config?.model;
                              const defaultModels = [
                                'Generic (SD 1.5)',
                                'Generic (SDXL)',
                                'Stable Diffusion v1.5 Inpainting',
                                'SDXL Inpainting 0.1',
                                'Flux.1 [schnell]',
                                'Flux.1 [dev]',
                                'Qwen Image Edit'
                              ];
                              const allModels = currentModel && !defaultModels.includes(currentModel) 
                                ? [currentModel, ...defaultModels] 
                                : defaultModels;
                              return allModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ));
                            })()}
                          </select>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] font-bold uppercase text-neutral-500">
                          <span>Seed</span>
                          <button 
                            onClick={() => setManualConfig((prev: any) => ({ ...prev, seed: -1 }))}
                            className="text-indigo-400 hover:text-indigo-300"
                          >
                            Randomize
                          </button>
                        </div>
                        <input 
                          type="number"
                          value={manualConfig?.seed ?? config?.seed ?? -1}
                          onChange={(e) => setManualConfig((prev: any) => ({ ...prev, seed: parseInt(e.target.value) }))}
                          className="w-full bg-[#0f0f0f] border border-[#2a2a2a] p-2 rounded-lg text-[10px] font-mono text-neutral-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        />
                      </div>

                      <div className="flex items-center justify-between p-2 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg">
                        <span className="text-[10px] text-neutral-500 font-bold uppercase">Restore Faces</span>
                        <button 
                          onClick={() => setManualConfig((prev: any) => ({ ...prev, restoreFaces: !prev?.restoreFaces }))}
                          className={cn(
                            "w-8 h-4 rounded-full transition-colors relative",
                            manualConfig?.restoreFaces ? "bg-indigo-500" : "bg-neutral-800"
                          )}
                        >
                          <div className={cn(
                            "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform",
                            manualConfig?.restoreFaces ? "left-[18px]" : "left-0.5"
                          )} />
                        </button>
                      </div>
                    </div>
                  ) : activeTab === 'next' ? (
                    <div className="space-y-4">
                      <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl space-y-3">
                        <div className="flex items-center gap-2 text-emerald-400">
                          <Sparkles className="w-3 h-3" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Post-Processing Tips</span>
                        </div>
                        <ul className="space-y-2">
                          {config?.postProcessingTips?.map((tip: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-[11px] text-neutral-400 leading-relaxed">
                              <div className="w-1 h-1 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                              {tip}
                            </li>
                          ))}
                          {(!config?.postProcessingTips || config.postProcessingTips.length === 0) && (
                            <li className="text-[11px] text-neutral-500 italic">No specific post-processing tips for this vision.</li>
                          )}
                        </ul>
                      </div>
                      <div className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                        <p className="text-[10px] text-indigo-400 font-bold uppercase mb-1">Pro Tip</p>
                        <p className="text-[11px] text-neutral-400 leading-relaxed">
                          These steps are recommended for a high-quality final result. Apply them in Draw Things after the initial generation is complete.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {config?.dynamicInsights?.map((insight: any, idx: number) => (
                        <div key={idx} className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl space-y-1">
                          <div className="flex items-center gap-2 text-indigo-400">
                            <Info className="w-3 h-3" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">{insight.topic}</span>
                          </div>
                          <p className="text-[11px] text-neutral-400 leading-relaxed">
                            {insight.insight}
                          </p>
                        </div>
                      ))}
                      {!config?.dynamicInsights && (
                        <div className="text-center py-8 text-neutral-600">
                          <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          <p className="text-[10px] uppercase font-bold tracking-widest">Generate to see insights</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest">Prompts</label>
                  </div>
                  <div className="space-y-3">
                    <div className="group relative">
                      <textarea
                        value={manualConfig?.prompt ?? config?.prompt ?? ''}
                        onChange={(e) => setManualConfig((prev: any) => ({ ...prev, prompt: e.target.value }))}
                        className="w-full bg-[#0f0f0f] border border-[#2a2a2a] p-3 rounded-xl text-[12px] text-neutral-300 leading-relaxed h-24 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
                      />
                      <button 
                        onClick={() => copyToClipboard(manualConfig?.prompt ?? config?.prompt ?? '', 'positive')}
                        className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {copiedType === 'positive' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-neutral-400" />}
                      </button>
                    </div>
                    <div className="group relative">
                      <textarea
                        value={manualConfig?.negativePrompt ?? config?.negativePrompt ?? ''}
                        onChange={(e) => setManualConfig((prev: any) => ({ ...prev, negativePrompt: e.target.value }))}
                        className="w-full bg-[#0f0f0f] border border-[#2a2a2a] p-3 rounded-xl text-[12px] text-neutral-500 leading-relaxed h-20 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
                      />
                      <button 
                        onClick={() => copyToClipboard(manualConfig?.negativePrompt ?? config?.negativePrompt ?? '', 'negative')}
                        className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {copiedType === 'negative' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-neutral-400" />}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-[#2a2a2a] bg-[#1a1a1a]">
            <button
              onClick={handleDownload}
              disabled={!manualConfig || isProcessingDownload}
              className="w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-neutral-200 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-colors disabled:opacity-20"
            >
              {isProcessingDownload ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isProcessingDownload ? 'Processing' : 'Export Image'}
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main Area: Canvas/Image Preview */}
      <main className="flex-1 flex flex-col relative bg-[#0f0f0f]">
        
        {/* Top Bar */}
        <header className="h-14 border-b border-[#2a2a2a] flex items-center justify-between px-6 bg-[#1a1a1a]/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="p-1.5 hover:bg-white/5 rounded-lg border border-[#2a2a2a]">
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <h1 className="text-sm font-bold tracking-tight uppercase">DrawThings Configurator</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                if (imagePreview && imagePreview.startsWith('blob:')) {
                  URL.revokeObjectURL(imagePreview);
                }
                setImage(null);
                setImagePreview(null);
                setUserVision('');
                setConfig(null);
                setManualConfig(null);
                setExistingMetadata(null);
                setShowMetadataAlert(false);
              }}
              className="px-3 py-1.5 hover:bg-white/5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-[#2a2a2a] transition-colors"
            >
              Reset Session
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-500 uppercase">Live AI Analysis</span>
            </div>
          </div>
        </header>

        {/* Canvas Area */}
        <div 
          className="flex-1 flex items-center justify-center p-12 overflow-hidden bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:24px_24px]"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={handleDrop}
        >
          <AnimatePresence mode="wait">
            {imagePreview ? (
              <motion.div 
                key="preview"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="relative max-w-full max-h-full group"
              >
                <img 
                  src={imagePreview} 
                  alt="Canvas" 
                  className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-[#2a2a2a]" 
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg hover:bg-black/80 transition-colors"
                    title="Replace Image"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Metadata Inspector - Always visible when image is present */}
                <div className="mt-8 w-full max-w-md mx-auto">
                  <MetadataInspector 
            file={image} 
            metadata={existingMetadata} 
            chunks={foundChunks} 
          />
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-6 text-neutral-600"
              >
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-64 h-64 border-2 border-dashed border-neutral-800 rounded-[40px] flex flex-col items-center justify-center gap-4 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-neutral-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-neutral-500 group-hover:text-indigo-400" />
                  </div>
                  <p className="text-sm font-medium">Drop image or paste to start</p>
                </div>
                <p className="text-xs uppercase tracking-widest opacity-50">Supports PNG, JPG, WEBP • Ctrl+V to paste</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Floating Metadata Alert */}
        <AnimatePresence>
          {showMetadataAlert && existingMetadata && (
            <motion.div
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 100, opacity: 0 }}
              className="absolute top-20 right-6 w-80 bg-amber-500/10 backdrop-blur-md border border-amber-500/20 rounded-2xl p-4 z-30 shadow-2xl shadow-black/50"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-bold text-amber-200 uppercase tracking-wider">Metadata Found</h3>
                    <button onClick={() => setShowMetadataAlert(false)} className="text-amber-500 hover:text-amber-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[11px] text-amber-200/70 leading-relaxed">
                    This image contains existing generation parameters. The AI will use these as a reference.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Model Guide Modal */}
        <AnimatePresence>
          {showModelGuide && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowModelGuide(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative w-full max-w-2xl bg-[#1a1a1a] border border-[#2a2a2a] rounded-[32px] p-8 shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-xl">
                      <HelpIcon className="w-5 h-5 text-indigo-400" />
                    </div>
                    <h2 className="text-xl font-bold">Model & Parameter Guide</h2>
                  </div>
                  <button onClick={() => setShowModelGuide(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-4 custom-scrollbar">
                  <section className="space-y-3">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Common Models</h3>
                    <div className="grid gap-3">
                      <GuideItem title="Inpainting Models" desc="Specialized versions of SD1.5 or SDXL designed to edit images seamlessly without artifacts." />
                      <GuideItem title="Flux.1 [schnell/dev]" desc="Next-gen models with incredible prompt adherence and text capability. 'schnell' is faster, 'dev' is higher quality." />
                      <GuideItem title="Qwen Image Edit" desc="A powerful model specifically trained for instruction-based image editing." />
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Parameters Explained</h3>
                    <div className="grid gap-3">
                      <GuideItem title="Steps (20-50)" desc="Number of iterations. Higher steps = more detail but slower. Diminishing returns after 50." />
                      <GuideItem title="CFG Scale (7-15)" desc="How strictly the AI follows your prompt. 7 is balanced, 15 is very strict (can look 'fried')." />
                      <GuideItem title="Denoising (0.1-0.9)" desc="For img2img. 0.1 = almost no change. 0.5 = balanced. 0.9 = complete transformation." />
                      <GuideItem title="Sampler" desc="The algorithm used. 'Euler a' is fast and smooth. 'DPM++ 2M Karras' is high quality and sharp." />
                    </div>
                  </section>
                </div>

                <div className="mt-8 pt-6 border-t border-[#2a2a2a] flex justify-end">
                  <button 
                    onClick={() => setShowModelGuide(false)}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-sm transition-all"
                  >
                    Got it
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #2a2a2a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3a3a3a;
        }
      `}} />
    </div>
  );
}

function GuideItem({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="bg-[#0f0f0f] border border-[#2a2a2a] p-4 rounded-2xl">
      <h4 className="text-sm font-bold text-neutral-200 mb-1">{title}</h4>
      <p className="text-xs text-neutral-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function DrawThingsSlider({ label, value, max, step = 1, onChange }: { label: string, value: number, max: number, step?: number, onChange?: (val: number) => void }) {
  const percentage = (value / max) * 100;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] font-bold uppercase text-neutral-500">
        <span>{label}</span>
        <span className="text-neutral-300">{value}</span>
      </div>
      <div className="relative h-1.5 bg-[#0f0f0f] rounded-full overflow-hidden border border-[#2a2a2a]">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className="h-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
        />
        <input 
          type="range"
          min={0}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(parseFloat(e.target.value))}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

function ExplainerItem({ title, content, icon }: { title: string, content?: string, icon: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
        {icon}
        <span>{title}</span>
      </div>
      <p className="text-[11px] text-neutral-400 leading-relaxed line-clamp-3 hover:line-clamp-none transition-all cursor-default">
        {content || "No explanation provided."}
      </p>
    </div>
  );
}

export default App;
