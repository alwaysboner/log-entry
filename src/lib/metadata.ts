
import pako from "pako";

// CRC32 table for PNG checksums
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Helper to create a tEXt chunk
 */
function createTextChunk(keyword: string, text: string): { type: string; data: Uint8Array } {
  const keywordBytes = stringToUint8Array(keyword);
  const textBytes = stringToUint8Array(text);
  
  const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData[keywordBytes.length] = 0; // Null separator
  chunkData.set(textBytes, keywordBytes.length + 1);

  return {
    type: "tEXt",
    data: chunkData
  };
}

/**
 * Helper to create an iTXt chunk (UTF-8)
 */
function createITextChunk(keyword: string, text: string): { type: string; data: Uint8Array } {
  const keywordBytes = stringToUint8Array(keyword);
  const textBytes = stringToUint8Array(text);
  
  // iTXt format: Keyword (null) Compression flag (1) Compression method (1) Language (null) Translated keyword (null) Text
  const chunkData = new Uint8Array(keywordBytes.length + 1 + 1 + 1 + 1 + 1 + textBytes.length);
  let pos = 0;
  chunkData.set(keywordBytes, pos);
  pos += keywordBytes.length;
  chunkData[pos++] = 0; // Null separator for keyword
  chunkData[pos++] = 0; // Compression flag: 0 (uncompressed)
  chunkData[pos++] = 0; // Compression method: 0
  chunkData[pos++] = 0; // Language tag: empty (null)
  chunkData[pos++] = 0; // Translated keyword: empty (null)
  chunkData.set(textBytes, pos);

  return {
    type: "iTXt",
    data: chunkData
  };
}

/**
 * Helper to create a zTXt chunk (compressed)
 */
function createZTextChunk(keyword: string, text: string): { type: string; data: Uint8Array } {
  const keywordBytes = stringToUint8Array(keyword);
  const textBytes = stringToUint8Array(text);
  const compressed = pako.deflate(textBytes);
  
  const chunkData = new Uint8Array(keywordBytes.length + 1 + 1 + compressed.length);
  chunkData.set(keywordBytes, 0);
  chunkData[keywordBytes.length] = 0; // Null separator
  chunkData[keywordBytes.length + 1] = 0; // Compression method: 0 (DEFLATE)
  chunkData.set(compressed, keywordBytes.length + 2);

  return {
    type: "zTXt",
    data: chunkData
  };
}

/**
 * Embeds metadata chunks into a PNG file, stripping any existing conflicting chunks.
 */
export async function embedPngMetadata(
  imageBlob: Blob,
  parameters: string,
  aiTips?: string
): Promise<Blob> {
  const arrayBuffer = await imageBlob.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // Check PNG signature
  if (
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47 ||
    data[4] !== 0x0d ||
    data[5] !== 0x0a ||
    data[6] !== 0x1a ||
    data[7] !== 0x0a
  ) {
    throw new Error("Not a valid PNG file");
  }

  // 1. Parse all chunks in order
  const chunks: { type: string; data: Uint8Array }[] = [];
  let offset = 8;

  while (offset + 8 <= data.length) {
    const length =
      ((data[offset] << 24) >>> 0) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    offset += 4;

    const type = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );
    offset += 4;

    const chunkData = data.subarray(offset, offset + length);
    offset += length;

    // Skip CRC
    offset += 4;

    chunks.push({ type, data: chunkData });
  }

  // 2. Filter and Reconstruct
  const outputChunks: { type: string; data: Uint8Array }[] = [];
  
  // Metadata chunks to add
  const newMetadata: { type: string; data: Uint8Array }[] = [];
  
  // A. Parameters (DrawThings/A1111)
  // Draw Things specifically uses iTXt for its parameters.
  newMetadata.push(createITextChunk("parameters", parameters));
  newMetadata.push(createTextChunk("parameters", parameters));
  newMetadata.push(createZTextChunk("parameters", parameters));
  newMetadata.push(createTextChunk("Parameters", parameters));
  newMetadata.push(createTextChunk("Comment", parameters));
  
  // D. XMP (Draw Things specific preference)
  const escapedParams = parameters.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xmpContent = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about=""
            xmlns:dc="http://purl.org/dc/elements/1.1/"
            xmlns:xmp="http://ns.adobe.com/xap/1.0/"
            xmlns:exif="http://ns.adobe.com/exif/1.0/">
         <dc:description>
            <rdf:Alt>
               <rdf:li xml:lang="x-default">${escapedParams}</rdf:li>
            </rdf:Alt>
         </dc:description>
         <exif:UserComment>${escapedParams}</exif:UserComment>
      </rdf:Description>
   </rdf:RDF>
</x:xmpmeta>
<?xpacket end="r"?>`;
  newMetadata.push(createITextChunk("XML:com.adobe.xmp", xmpContent));
  
  // B. Software
  newMetadata.push(createTextChunk("Software", "Draw Things"));
  
  // C. Description (AI Tips/Insights)
  if (aiTips) {
    newMetadata.push(createTextChunk("Description", aiTips));
  }

  // Identify where to inject
  // PNG spec: IHDR must be first. sRGB, gAMA, etc. should be early.
  // We'll keep IHDR and "header" chunks at the top, then inject our metadata.
  const headerTypes = ["IHDR", "sRGB", "gAMA", "cHRM", "PLTE", "tRNS"];
  let lastHeaderIndex = -1;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let shouldStrip = false;
    
    // We strip existing metadata chunks to avoid conflicts
    if (chunk.type === "tEXt" || chunk.type === "zTXt" || chunk.type === "iTXt") {
      let nullIndex = -1;
      for (let j = 0; j < chunk.data.length; j++) {
        if (chunk.data[j] === 0) {
          nullIndex = j;
          break;
        }
      }
      if (nullIndex !== -1) {
        const keyword = new TextDecoder().decode(chunk.data.subarray(0, nullIndex));
        const lowerKey = keyword.toLowerCase();
        if (
          lowerKey === "parameters" || 
          lowerKey === "software" || 
          lowerKey === "description" || 
          lowerKey === "comment" ||
          lowerKey.includes("xmp")
        ) {
          shouldStrip = true;
        }
      }
    }

    // We also strip eXIf if we are injecting new metadata, as it often contains
    // conflicting UserComment fields that Draw Things might prefer.
    if (chunk.type === "eXIf") {
      shouldStrip = true;
    }

    if (!shouldStrip) {
      outputChunks.push(chunk);
      if (headerTypes.includes(chunk.type)) {
        lastHeaderIndex = outputChunks.length;
      }
    }
  }

  // Inject our new metadata after the last header chunk (or after IHDR)
  if (lastHeaderIndex !== -1) {
    outputChunks.splice(lastHeaderIndex, 0, ...newMetadata);
  } else {
    // Fallback: inject after IHDR (which should always be at index 0)
    outputChunks.splice(1, 0, ...newMetadata);
  }

  // 3. Finalize PNG
  const totalSize = 8 + outputChunks.reduce((acc, c) => acc + 12 + c.data.length, 0);
  const result = new Uint8Array(totalSize);
  result.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  
  let currentOffset = 8;
  for (const chunk of outputChunks) {
    const len = chunk.data.length;
    result[currentOffset++] = (len >>> 24) & 0xff;
    result[currentOffset++] = (len >>> 16) & 0xff;
    result[currentOffset++] = (len >>> 8) & 0xff;
    result[currentOffset++] = len & 0xff;
    
    const typeBytes = stringToUint8Array(chunk.type);
    result.set(typeBytes, currentOffset);
    currentOffset += 4;
    
    result.set(chunk.data, currentOffset);
    currentOffset += chunk.data.length;
    
    const crcInput = new Uint8Array(4 + chunk.data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(chunk.data, 4);
    const c = crc32(crcInput);
    result[currentOffset++] = (c >>> 24) & 0xff;
    result[currentOffset++] = (c >>> 16) & 0xff;
    result[currentOffset++] = (c >>> 8) & 0xff;
    result[currentOffset++] = c & 0xff;
  }

  return new Blob([result], { type: "image/png" });
}

export function formatParameters(config: any): string {
  // Standard Automatic1111/DrawThings format
  // Positive Prompt
  // Negative prompt: ...
  // Steps: X, Sampler: X, CFG scale: X, Seed: X, Size: WxH, Model: X, Denoising strength: X
  
  let paramStr = `${config.prompt || ''}\n`;
  if (config.negativePrompt) {
    paramStr += `Negative prompt: ${config.negativePrompt}\n`;
  }
  
  const parts = [];
  parts.push(`Steps: ${config.steps}`);
  parts.push(`Sampler: ${config.sampler}`);
  
  // Draw Things uses "Guidance Scale", A1111 uses "CFG scale"
  // Using toFixed(1) to match Draw Things formatting (e.g., 2.0)
  const cfg = typeof config.cfgScale === 'number' ? config.cfgScale.toFixed(1) : config.cfgScale;
  parts.push(`CFG scale: ${cfg}`);
  parts.push(`Guidance Scale: ${cfg}`);
  
  parts.push(`Seed: ${config.seed}`);
  parts.push(`Seed Mode: Scale Alike`);
  
  if (config.width && config.height) {
    parts.push(`Size: ${config.width}x${config.height}`);
  }
  
  if (config.model) {
    parts.push(`Model: ${config.model}`);
  }
  
  if (config.denoisingStrength !== undefined) {
    const strength = typeof config.denoisingStrength === 'number' ? config.denoisingStrength.toFixed(1) : config.denoisingStrength;
    parts.push(`Denoising strength: ${strength}`);
    parts.push(`Strength: ${strength}`);
  }
  
  paramStr += parts.join(', ');
  
  return paramStr;
}

export function parseParameters(paramStr: string): any {
  const config: any = {
    prompt: '',
    negativePrompt: '',
    steps: 20,
    cfgScale: 7.5,
    sampler: 'Euler a',
    seed: -1,
    model: 'v1.5',
    denoisingStrength: 0.5
  };

  const lines = paramStr.split('\n');
  
  // Find the settings line (contains "Steps:")
  let settingsLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('Steps:')) {
      settingsLineIndex = i;
      break;
    }
  }

  if (settingsLineIndex !== -1) {
    // Negative prompt is usually the line(s) before settings, starting with "Negative prompt:"
    let negativePromptLineIndex = -1;
    for (let i = settingsLineIndex - 1; i >= 0; i--) {
      if (lines[i].startsWith('Negative prompt:')) {
        negativePromptLineIndex = i;
        config.negativePrompt = lines[i].replace('Negative prompt: ', '').trim();
        break;
      }
    }
    
    // Positive prompt is everything before negative prompt (or before settings)
    const promptEndIndex = negativePromptLineIndex !== -1 ? negativePromptLineIndex : settingsLineIndex;
    config.prompt = lines.slice(0, promptEndIndex).join('\n').trim();

    const extract = (regex: RegExp) => {
      const match = paramStr.match(regex);
      return match ? match[1] : null;
    };

    const steps = extract(/Steps: (\d+)/);
    if (steps) config.steps = parseInt(steps);

    const cfg = extract(/(?:CFG scale|Guidance Scale): ([\d.]+)/);
    if (cfg) config.cfgScale = parseFloat(cfg);

    const sampler = extract(/Sampler: ([^,]+)/);
    if (sampler) config.sampler = sampler.trim();

    const seed = extract(/Seed: (\d+)/);
    if (seed) config.seed = parseInt(seed);

    const model = extract(/Model: ([^,]+)/);
    if (model) config.model = model.trim();

    const denoising = extract(/(?:Denoising strength|Strength): ([\d.]+)/);
    if (denoising) config.denoisingStrength = parseFloat(denoising);

    const size = extract(/Size: (\d+x\d+)/);
    if (size) {
      const [w, h] = size.split('x');
      config.width = parseInt(w);
      config.height = parseInt(h);
    }
  } else {
    // Fallback if no Steps: found
    config.prompt = paramStr.trim();
  }

  return config;
}

export async function readPngMetadata(file: File): Promise<{ text: string | null, chunks: string[] } | null> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // Check PNG signature
  if (
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47 ||
    data[4] !== 0x0d ||
    data[5] !== 0x0a ||
    data[6] !== 0x1a ||
    data[7] !== 0x0a
  ) {
    console.log("Not a valid PNG signature");
    return null;
  }

  let offset = 8;
  const metadataMap: Record<string, string> = {};
  let fallbackParams: string | null = null;
  const foundChunks: string[] = [];

  while (offset + 8 <= data.length) {
    const length =
      ((data[offset] << 24) >>> 0) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    
    offset += 4;

    const type = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );
    
    offset += 4;
    foundChunks.push(type);

    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const chunkData = data.subarray(offset, offset + length);
      
      let nullIndex = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIndex = i;
          break;
        }
      }

      if (nullIndex !== -1) {
        try {
          const keyword = new TextDecoder().decode(chunkData.subarray(0, nullIndex)).toLowerCase();
          let text: string | null = null;

          if (type === "tEXt") {
            text = new TextDecoder().decode(chunkData.subarray(nullIndex + 1));
          } else if (type === "zTXt") {
            if (nullIndex + 2 <= chunkData.length) {
              const compressionMethod = chunkData[nullIndex + 1];
              if (compressionMethod === 0) { // DEFLATE
                const compressedText = chunkData.subarray(nullIndex + 2);
                try {
                  const decompressed = pako.inflate(compressedText);
                  text = new TextDecoder().decode(decompressed);
                } catch (e) {
                  console.warn(`Failed to decompress zTXt chunk with keyword "${keyword}"`, e);
                }
              }
            }
          } else if (type === "iTXt") {
            let pos = nullIndex + 1;
            if (pos + 2 <= chunkData.length) {
              const compressionFlag = chunkData[pos++];
              const compressionMethod = chunkData[pos++];
              
              let langNull = -1;
              for (let i = pos; i < chunkData.length; i++) {
                if (chunkData[i] === 0) {
                  langNull = i;
                  break;
                }
              }
              
              if (langNull !== -1) {
                pos = langNull + 1;
                let transNull = -1;
                for (let i = pos; i < chunkData.length; i++) {
                  if (chunkData[i] === 0) {
                    transNull = i;
                    break;
                  }
                }
                
                if (transNull !== -1) {
                  pos = transNull + 1;
                  const textData = chunkData.subarray(pos);
                  if (compressionFlag === 0) {
                    text = new TextDecoder().decode(textData);
                  } else if (compressionFlag === 1 && compressionMethod === 0) {
                    try {
                      const decompressed = pako.inflate(textData);
                      text = new TextDecoder().decode(decompressed);
                    } catch (e) {
                      console.warn(`Failed to decompress iTXt chunk with keyword "${keyword}"`, e);
                    }
                  }
                }
              }
            }
          }

          if (text) {
            console.log(`Found metadata chunk: type=${type}, keyword="${keyword}", length=${text.length}`);
            
            // If the text looks like XML/XMP, try to extract the content from common tags
            if (text.includes("<?xpacket") || text.includes("<x:xmpmeta")) {
              // Try to find content inside <rdf:li> or <dc:description> or <exif:UserComment>
              const liMatch = text.match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
              const descMatch = text.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
              const commMatch = text.match(/<exif:UserComment[^>]*>([\s\S]*?)<\/exif:UserComment>/i);
              
              const extracted = liMatch?.[1] || descMatch?.[1] || commMatch?.[1];
              if (extracted) {
                // Clean up XML entities if any
                text = extracted
                  .replace(/&quot;/g, '"')
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .trim();
                console.log(`Extracted text from XMP: ${text.substring(0, 50)}...`);
              }
            }

            metadataMap[keyword] = text;
            
            // If this looks like parameters but isn't labeled as such, keep it as fallback
            if (text.includes("Steps:") && text.includes("Sampler:")) {
              fallbackParams = text;
            }
          }
        } catch (e) {
          console.error(`Error parsing ${type} chunk at offset ${offset}`, e);
        }
      }
    }

    offset += length + 4;
  }

  // Prioritize keywords
  const result = metadataMap["parameters"] || 
                 metadataMap["prompt"] || 
                 metadataMap["comment"] || 
                 metadataMap["description"] || 
                 metadataMap["software"] || 
                 fallbackParams;

  // Last-ditch effort: if no metadata found, search the whole file for "Steps:" and "Sampler:"
  // This can catch metadata in EXIF or other chunks we didn't parse correctly.
  if (!result) {
    try {
      const fullText = new TextDecoder().decode(data);
      const stepsIdx = fullText.indexOf("Steps:");
      const samplerIdx = fullText.indexOf("Sampler:");
      
      if (stepsIdx !== -1 && samplerIdx !== -1) {
        // Find the start of the prompt (usually before Steps:)
        // We'll take a chunk of text around there
        const start = Math.max(0, stepsIdx - 1000);
        const end = Math.min(fullText.length, stepsIdx + 2000);
        const candidate = fullText.substring(start, end);
        
        console.log("Found metadata via last-ditch full-file search");
        return { text: candidate, chunks: foundChunks };
      }
    } catch (e) {
      console.warn("Last-ditch metadata search failed", e);
    }
  }

  if (result) {
    console.log("Successfully extracted metadata parameters");
  } else {
    console.log("No recognized metadata parameters found in PNG");
  }

  return { text: result, chunks: foundChunks };
}
