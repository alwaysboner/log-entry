import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini
// Note: We use the client-side key for this demo as requested in the system prompt for "my data" style apps.
// The user explicitly requested import.meta.env.VITE_GEMINI_API_KEY for bundling compatibility.
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey });

export interface GenerationConfig {
  prompt: string;
  negativePrompt: string;
  steps: number;
  cfgScale: number;
  sampler: string;
  model: string;
  denoisingStrength?: number;
  seed: number;
  explanations?: {
    model: string;
    steps: string;
    cfgScale: string;
    denoisingStrength: string;
    sampler: string;
  };
  dynamicInsights?: Array<{
    topic: string;
    insight: string;
  }>;
  postProcessingTips?: string[];
}

export async function generateConfig(
  imageBase64: string,
  userVision: string,
  existingMetadata?: string,
  forceModel?: string
): Promise<GenerationConfig> {
    const prompt = `
    Analyze this image and the user's vision: "${userVision}".
    ${existingMetadata ? `NOTE: The image has existing metadata: ${existingMetadata}. Consider this as the starting point but adapt to the new vision.` : ""}
    ${forceModel ? `CRITICAL: The user has explicitly selected the model: "${forceModel}". You MUST use this model in your configuration. Optimize all other parameters (steps, CFG, sampler, denoising) specifically for this model.` : ""}
    
    Generate a configuration for an AI image generator (Draw Things) to transform this image into the user's vision using an Image-to-Image (img2img) or Inpainting workflow.
    
    ${!forceModel ? `
    CRITICAL: You MUST select the 'model' from the following list of supported Draw Things models:
    - 'Generic (SD 1.5)'
    - 'Generic (SDXL)'
    - 'Stable Diffusion v1.5 Inpainting'
    - 'SDXL Inpainting 0.1'
    - 'Flux.1 [schnell]'
    - 'Flux.1 [dev]'
    - 'Qwen Image Edit'
    
    Choose the model that best fits the user's request (e.g., use 'Generic (SDXL)' for high quality, 'Flux' for high adherence, 'Inpainting' models for heavy edits).
    ` : ""}
    
    Provide a highly detailed prompt that describes the desired outcome based on the user's vision, while keeping relevant structural details from the original image if implied.
    Suggest appropriate technical parameters (Steps, CFG, Sampler, Denoising Strength).
    
    CRITICAL: Also provide educational explanations for WHY you chose these specific values for this specific image and vision.
    - Model: Why is this model architecture (SD1.5, SDXL, etc.) good for this specific request?
    - Steps: Why this number? (e.g., "Higher steps needed for complex texture...")
    - CFG Scale: Why this adherence level? (e.g., "Lower CFG to allow more creativity...")
    - Denoising: Why this strength? (e.g., "0.4 to keep outlines but change style...")
    - Sampler: Why this sampler?
    
    Additionally, provide 3 "Dynamic Insights" that are specific to the image content. 
    For example, if the image is a face, talk about 'Restore Faces' or 'Adetailer'. 
    If it's a landscape, talk about 'Hires. fix' or 'Tiling'.

    CRITICAL: Also provide a separate list of "Post-Processing Tips" for actions that should be taken AFTER the initial generation (e.g., "Upscale 2x for high resolution", "Use Inpaint to fix hands", "Apply Face Restore if features are blurry"). These should be distinct from the core generation parameters.
  `;

  try {
    // Extract base64 data and mime type
    const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : "image/png";
    const data = matches ? matches[2] : imageBase64;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: data } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: "Detailed positive prompt for Stable Diffusion/Draw Things",
            },
            negativePrompt: {
              type: Type.STRING,
              description: "Comprehensive negative prompt",
            },
            steps: {
              type: Type.INTEGER,
              description: "Number of sampling steps (e.g., 20-50)",
            },
            cfgScale: {
              type: Type.NUMBER,
              description: "CFG Scale (e.g., 7.0-15.0)",
            },
            sampler: {
              type: Type.STRING,
              description: "Sampler name (e.g., 'Euler a', 'DPM++ 2M Karras')",
            },
            model: {
              type: Type.STRING,
              description: "Suggested model type (e.g., 'v1.5', 'SDXL', 'Realistic Vision')",
            },
            denoisingStrength: {
              type: Type.NUMBER,
              description: "Denoising strength for img2img (0.0-1.0). Higher means more change.",
            },
            seed: {
              type: Type.INTEGER,
              description: "Random seed (use -1 for random, or a specific number)",
            },
            explanations: {
              type: Type.OBJECT,
              properties: {
                model: { type: Type.STRING, description: "Educational explanation for the model choice" },
                steps: { type: Type.STRING, description: "Educational explanation for the steps choice" },
                cfgScale: { type: Type.STRING, description: "Educational explanation for the CFG scale choice" },
                denoisingStrength: { type: Type.STRING, description: "Educational explanation for the denoising strength choice" },
                sampler: { type: Type.STRING, description: "Educational explanation for the sampler choice" },
              },
              required: ["model", "steps", "cfgScale", "denoisingStrength", "sampler"],
            },
            dynamicInsights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  topic: { type: Type.STRING, description: "The topic name (e.g., 'Face Restoration')" },
                  insight: { type: Type.STRING, description: "The specific advice for this image" }
                },
                required: ["topic", "insight"]
              },
              description: "3 dynamic insights specific to the image content"
            },
            postProcessingTips: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
              },
              description: "List of recommended post-processing steps (e.g., Upscale, Inpaint, Face Restore)"
            }
          },
          required: ["prompt", "negativePrompt", "steps", "cfgScale", "sampler", "model", "explanations", "dynamicInsights", "postProcessingTips"],
        },
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("No response text from Gemini");
    }
    return JSON.parse(responseText) as GenerationConfig;
  } catch (error) {
    console.error("Error generating config:", error);
    throw new Error("Failed to generate configuration from Gemini.");
  }
}
