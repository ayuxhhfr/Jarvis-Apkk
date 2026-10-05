/**
 * JARVIS Full-Stack Server
 * Integrates Express, Vite middleware, WebSocketServer, and the Google GenAI Live API.
 */

import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, ThinkingLevel, LiveServerMessage } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "3000", 10);
const CHAT_MODEL = "gemini-3.8-flash";
const LIVE_MODEL = "gemini-3.1-flash-live-preview";
const TTS_MODEL = "gemini-3.8-flash-lite-tts";
const MEMORY_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_VOICE = "Enceladus";

const JARVIS_SYSTEM_INSTRUCTION = `You are JARVIS, a personal AI assistant.

You communicate naturally through both voice and text.

Your personality is:

- intelligent
- calm
- confident
- respectful
- concise
- helpful
- natural
- slightly witty when appropriate

You are a sophisticated personal assistant, not a generic chatbot.

Speak naturally.

Do not constantly mention that you are an AI.

Do not unnecessarily repeat the user's question.

Answer directly.

For simple questions, keep responses concise.

For complex questions, provide a clear structured response.

Maintain context throughout the current conversation.

LONG-TERM MEMORY:
- You have persistent long-term memory across sessions.
- When the user asks you to remember something (e.g. "Remember that I use TypeScript", "Remember my main project is JARVIS"), call save_memory and confirm concisely (e.g. "Got it. I'll remember that you use TypeScript." or "Understood, I've noted that your main project is JARVIS.").
- When the user asks you to forget something (e.g. "Forget that I use TypeScript", "Forget my main project"), call delete_memory and confirm (e.g. "I've forgotten that.").
- When the user asks "What do you remember about me?" or "Show my memories", retrieve and summarize what you remember clearly.
- When answering general questions, use any relevant active memories naturally to contextualize your response. Do NOT say "According to my memory..." unless explicitly asked.
- Do not save every casual message automatically. Only save when the user explicitly asks to remember or states an important lasting fact/preference.

REAL-TIME SCREEN SHARING & VISION:
- You have real-time visual perception and screen analysis capability.
- When the user asks to look at their screen (e.g. "Share my screen", "Look at my screen", "Can you see my screen?", "Start screen sharing"), invoke start_screen_share and acknowledge naturally (e.g. "Requesting screen access now.").
- When the user asks to stop sharing (e.g. "Stop screen sharing", "Stop looking at my screen"), invoke stop_screen_share and acknowledge (e.g. "Screen sharing stopped.").
- When screen sharing is active, you can visually analyze whatever is displayed on the user's screen (inspecting code, reading errors, explaining UI, debugging, analyzing documents).
- Only analyze the screen when relevant to the user's request or when they ask about visual elements. Do not recite visual descriptions on unrelated prompts.

BROWSER TOOLS:
- You have access to a built-in browser with tools: open_website, search_google, search_youtube, navigate_browser, go_back, go_forward, reload_page, close_browser.
- When the user asks to open a website, search Google, search YouTube, navigate, or close the browser, invoke the appropriate tool.
- Keep responses natural and concise: "Sure.", "Yep, opening YouTube.", "Got it." Do not over-explain simple actions.

If the user interrupts you while you are speaking, immediately stop the current response and listen to the user.

Never pretend to have performed an action that you did not actually perform.

If an action requires a tool that is not currently available, clearly say so.

Do not fabricate information.

If you do not know something, say that you do not know.

Address the user naturally without constantly using their name.

Your primary goal is to be useful, fast, natural, and conversational.

You are JARVIS.`;

// Initialize GoogleGenAI client
const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Memory Function Declarations for Gemini Tool Calling
const MEMORY_FUNCTION_DECLARATIONS = [
  {
    name: "save_memory",
    description:
      "Save a piece of important information, preference, project detail, or fact about the user to persistent long-term memory. Use when user explicitly asks to remember something or provides an enduring preference.",
    parameters: {
      type: "OBJECT",
      properties: {
        content: {
          type: "STRING",
          description: "The clear factual statement to remember, e.g. 'The user uses TypeScript' or 'The user's main project is JARVIS'.",
        },
        category: {
          type: "STRING",
          description: "Category of the memory: 'personal', 'preference', 'project', 'instruction', 'technical', or 'other'.",
        },
        importance: {
          type: "NUMBER",
          description: "Importance level from 1 (minor) to 5 (critical). Default is 3.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "search_memories",
    description:
      "Search the user's persistent long-term memory for relevant facts, preferences, project details, or past notes.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search keywords or question to find in stored memories.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_memories",
    description:
      "Retrieve all saved long-term memories about the user, optionally filtered by category.",
    parameters: {
      type: "OBJECT",
      properties: {
        category: {
          type: "STRING",
          description: "Optional category filter: 'personal', 'preference', 'project', 'instruction', 'technical', or 'other'.",
        },
      },
    },
  },
  {
    name: "delete_memory",
    description:
      "Delete or forget a specific memory when the user asks to forget something (e.g. 'Forget that I use TypeScript', 'Forget my main project').",
    parameters: {
      type: "OBJECT",
      properties: {
        target: {
          type: "STRING",
          description: "The memory topic, phrase, or keyword to forget.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "clear_memories",
    description:
      "Clear and delete ALL long-term memories when the user asks to wipe or clear all memories.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

// Browser Function Declarations for Gemini Tool Calling
const BROWSER_FUNCTION_DECLARATIONS = [
  {
    name: "open_website",
    description:
      "Open a specified website or popular service (e.g. YouTube, Google, Spotify, GitHub, Netflix, Instagram, Reddit) inside the JARVIS built-in browser overlay.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "The full URL or domain to open, e.g. 'https://www.youtube.com'",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "search_google",
    description:
      "Search Google for a query and show results inside the JARVIS built-in browser overlay.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search keywords or question to search on Google",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_youtube",
    description:
      "Search YouTube for videos on a query and open results inside the JARVIS built-in browser overlay.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Keywords or topic to search on YouTube",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "navigate_browser",
    description: "Navigate the active JARVIS browser tab to a specified destination URL.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "The destination URL to navigate to",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "go_back",
    description: "Navigate backward in the JARVIS browser history.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "go_forward",
    description: "Navigate forward in the JARVIS browser history.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "reload_page",
    description: "Reload the current page in the JARVIS browser.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "close_browser",
    description:
      "Close the JARVIS built-in browser overlay and return to the main JARVIS assistant screen.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

// Screen Share Function Declarations for Gemini Tool Calling
const SCREEN_SHARE_FUNCTION_DECLARATIONS = [
  {
    name: "start_screen_share",
    description:
      "Request the user to start real-time screen sharing using their browser so JARVIS can visually see, inspect, and analyze their screen, code, errors, documents, or active browser tabs.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "stop_screen_share",
    description:
      "Stop active screen sharing and release screen capture when the user asks to stop sharing or stop looking at the screen.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

const ALL_FUNCTION_DECLARATIONS = [
  ...MEMORY_FUNCTION_DECLARATIONS,
  ...SCREEN_SHARE_FUNCTION_DECLARATIONS,
  ...BROWSER_FUNCTION_DECLARATIONS,
];

// Map application voice selection to valid Gemini Live API prebuilt voices
const GEMINI_LIVE_VOICES: Record<string, string> = {
  aoede: "Aoede",
  kore: "Kore",
  puck: "Puck",
  charon: "Charon",
  fenrir: "Fenrir",
  enceladus: "Charon",
  zephyr: "Aoede",
  ira: "Aoede",
  jarvis: "Charon",
};

function getValidLiveVoice(voiceName?: string): string {
  if (!voiceName) return "Charon";
  const lower = voiceName.trim().toLowerCase();
  return GEMINI_LIVE_VOICES[lower] || "Charon";
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrades exclusively for /api/live-ws
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/api/live-ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  // Gemini Live WebSocket Bridge
  wss.on("connection", async (clientWs: WebSocket) => {
    if (!apiKey) {
      clientWs.send(
        JSON.stringify({
          error: "GEMINI_API_KEY is not configured in the server environment.",
        })
      );
      clientWs.close();
      return;
    }

    let liveSession: any = null;
    let isSessionOpen = false;
    let voiceOnly = true;
    let voiceOutputActive = false;

    const initLiveSession = async (config: {
      model?: string;
      voice?: string;
      systemInstruction?: string;
      greeting?: string;
      voiceOnly?: boolean;
    }) => {
      if (liveSession) {
        try {
          if (typeof liveSession.close === "function") liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
        isSessionOpen = false;
      }

      const modelName = config.model || LIVE_MODEL;
      const voiceName = getValidLiveVoice(config.voice || DEFAULT_VOICE);
      const systemInstruction = config.systemInstruction || JARVIS_SYSTEM_INSTRUCTION;
      voiceOnly = config.voiceOnly !== false;
      voiceOutputActive = false;

      try {
        liveSession = await ai.live.connect({
          model: modelName,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceName },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // @ts-ignore
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.MINIMAL,
            },
            systemInstruction: systemInstruction,
            // 3.1 Live is a voice I/O engine in the new architecture.
            // Its independent tool/reasoning path is disabled so 3.8 remains authoritative.
            ...(voiceOnly ? {} : {
              // @ts-ignore
              tools: [{ functionDeclarations: ALL_FUNCTION_DECLARATIONS }],
            }),
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              if (clientWs.readyState !== WebSocket.OPEN) return;

              const parts = message.serverContent?.modelTurn?.parts;
              if (parts && parts.length > 0 && voiceOutputActive) {
                for (const part of parts) {
                  if (part.inlineData?.data) clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                  if (part.text) clientWs.send(JSON.stringify({ text: part.text }));
                }
              }

              // Output transcription is only exposed for the manager answer that
              // was explicitly requested through the speak channel.
              const outText = message.serverContent?.outputTranscription?.text;
              if (outText && voiceOutputActive) clientWs.send(JSON.stringify({ text: outText }));

              // Input audio transcription
              const inText = message.serverContent?.inputTranscription?.text;
              if (inText) {
                clientWs.send(
                  JSON.stringify({
                    userTranscript: inText,
                    // Never treat the mere presence of transcript text as a
                    // completed utterance. Gemini Live sends transcript
                    // fragments; completion is finalized by an explicit
                    // finished flag or the subsequent turnComplete/model turn.
                    finished: message.serverContent?.inputTranscription?.finished === true,
                  })
                );
              }

              // Handle Gemini Live tool calls only in legacy non-voice-only sessions.
              const toolCall = (message as any).toolCall;
              if (!voiceOnly && toolCall?.functionCalls && toolCall.functionCalls.length > 0) {
                for (const call of toolCall.functionCalls) {
                  clientWs.send(
                    JSON.stringify({
                      toolCall: {
                        id: call.id,
                        name: call.name,
                        args: call.args || {},
                      },
                    })
                  );
                }
              }

              if (message.serverContent?.interrupted) {
                clientWs.send(JSON.stringify({ interrupted: true }));
              }

              if (message.serverContent?.turnComplete) {
                if (voiceOutputActive) {
                  voiceOutputActive = false;
                  clientWs.send(JSON.stringify({ turnComplete: true }));
                }
              }
            },
            onerror: (err: any) => {
              console.error("Gemini Live session error:", err);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(
                  JSON.stringify({
                    error: err?.message || "Live API error occurred.",
                  })
                );
              }
            },
            onclose: () => {
              isSessionOpen = false;
            },
          },
        });

        isSessionOpen = true;

        console.log(
          `[GeminiLive Server] Live session connected successfully. Requested Voice: "${config.voice}" -> Resolved Voice: "${voiceName}" | Model: "${modelName}"`
        );

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "sessionReady",
              voice: voiceName,
              requestedVoice: config.voice,
              model: modelName,
            })
          );
        }

        if (config.greeting && isSessionOpen) {
          try {
            liveSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [{ text: `[System directive: Speak aloud this exact message to greet the user: "${config.greeting}"]` }],
                },
              ],
              turnComplete: true,
            });
          } catch (greetErr) {
            console.warn("Error sending live greeting:", greetErr);
          }
        }
      } catch (err: any) {
        console.error("Failed to connect to Gemini Live:", err);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              error: `Live connection failed: ${err?.message || "Unknown error"}`,
            })
          );
        }
      }
    };

    // Handle incoming client messages
    clientWs.on("message", async (raw) => {
      try {
        const payload = JSON.parse(raw.toString());

        // Handle explicit session initialization/re-configuration (setup)
        if (payload.type === "setup") {
          await initLiveSession(payload);
          return;
        }

        // Lazy initialize fallback if audio or text arrives before setup
        if (!liveSession && !isSessionOpen) {
          await initLiveSession({});
        }

        // Audio chunk from microphone (16kHz PCM base64)
        if (payload.audio && isSessionOpen && liveSession) {
          liveSession.sendRealtimeInput({
            audio: {
              data: payload.audio,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        }

        // Real-time visual screen frame from user screen share
        if ((payload.type === "screenFrame" || payload.image) && isSessionOpen && liveSession) {
          try {
            const frameBase64 = payload.image || payload.data;
            const mime = payload.mimeType || "image/jpeg";
            if (frameBase64 && typeof liveSession.sendRealtimeInput === "function") {
              liveSession.sendRealtimeInput({
                media: {
                  data: frameBase64,
                  mimeType: mime,
                },
              });
            }
          } catch (frameErr) {
            console.warn("Live API screen frame transmission error:", frameErr);
          }
        }

        // 3.8 Manager -> 3.1 Live voice handoff. The Live model receives
        // only the already-decided final answer and speaks it aloud.
        if (payload.type === "speak" && payload.text && isSessionOpen && liveSession) {
          voiceOutputActive = true;
          liveSession.sendClientContent({
            turns: [{
              role: "user",
              parts: [{ text: `[VOICE OUTPUT ONLY] Speak the following final JARVIS manager response exactly as written. Do not add, remove, reinterpret, answer, or call any tool. Response: ${payload.text}` }],
            }],
            turnComplete: true,
          });
        }

        // Legacy text channel is retained for compatibility, but voice-only
        // sessions never use it as the conversational brain.
        if (payload.type === "text" && payload.text && isSessionOpen && liveSession && !voiceOnly) {
          liveSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text: payload.text }] }],
            turnComplete: true,
          });
        }

        // Interruption signal: stop model turn
        if (payload.type === "interrupt" && isSessionOpen && liveSession) {
          voiceOutputActive = false;
          // Interruption is communicated to live session
          try {
            if (typeof liveSession.sendRealtimeInput === "function") {
              liveSession.sendRealtimeInput({
                audio: { data: "", mimeType: "audio/pcm;rate=16000" },
              });
            }
          } catch {
            // ignore
          }
        }

        // Tool execution response from client browser manager
        if (payload.type === "toolResponse" && isSessionOpen && liveSession) {
          try {
            if (typeof liveSession.sendToolResponse === "function") {
              liveSession.sendToolResponse({
                functionResponses: [
                  {
                    id: payload.id,
                    name: payload.name,
                    response: { output: payload.response || { success: true } },
                  },
                ],
              });
            }
          } catch (toolErr) {
            console.error("Error sending tool response to liveSession:", toolErr);
          }
        }
      } catch (err) {
        console.error("Error processing client WebSocket message:", err);
      }
    });

    clientWs.on("close", () => {
      isSessionOpen = false;
      if (liveSession && typeof liveSession.close === "function") {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
      }
    });

    clientWs.on("error", (e) => {
      console.error("Client WS error:", e);
    });
  });

  // REST API: Server & Key Health Check
  app.get("/api/status", (_req, res) => {
    res.json({
      ok: true,
      hasKey: !!apiKey,
      managerModel: CHAT_MODEL,
      voiceModel: LIVE_MODEL,
      voice: DEFAULT_VOICE,
      thinkingLevel: "minimal",
      status: apiKey ? "operational" : "missing_key",
    });
  });

  // REST API: Gemini 3.8 JARVIS Manager.
  // 3.8 owns reasoning and final answers. Gemini Live is voice I/O only.
  app.post("/api/gemini/manager", async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const { message, systemInstruction, history, context, image } = req.body;
    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      const contents: any[] = [];
      if (Array.isArray(history)) {
        for (const h of history) {
          if (!h?.text) continue;
          contents.push({
            role: h.role === "user" ? "user" : "model",
            parts: [{ text: h.text }],
          });
        }
      }

      const userParts: any[] = [{
        text: [message, context || ""].filter(Boolean).join("\n\n"),
      }];
      if (image?.data) {
        userParts.push({
          inlineData: {
            data: image.data,
            mimeType: image.mimeType || "image/jpeg",
          },
        });
      }
      contents.push({ role: "user", parts: userParts });

      const managerConfig = {
        systemInstruction:
          (systemInstruction || JARVIS_SYSTEM_INSTRUCTION) +
          "\n\n[ARCHITECTURE] Gemini 3.8 Flash is the authoritative JARVIS manager. It owns reasoning, context, decisions and the final answer. Gemini 3.1 Flash Live Preview is only the realtime voice I/O engine; never treat its independent model output as the authoritative answer. Application actions such as browser, screen-share and memory commands are executed by the JARVIS client orchestration layer; do not emit function calls from this manager endpoint.",
        // @ts-ignore
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      };

      let streamResponse: any;
      let managerModel = CHAT_MODEL;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          streamResponse = await ai.models.generateContentStream({
            model: CHAT_MODEL,
            contents,
            config: managerConfig,
          });
          break;
        } catch (managerError: any) {
          const status = Number(managerError?.status || managerError?.code || 0);
          if (status !== 429 && status !== 503 || attempt === 2) {
            if (attempt === 2 && (status === 429 || status === 503)) {
              managerModel = "gemini-3.7-flash";
              streamResponse = await ai.models.generateContentStream({
                model: managerModel,
                contents,
                config: managerConfig,
              });
              break;
            }
            throw managerError;
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }

      for await (const chunk of streamResponse) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
        const functionCalls = chunk.functionCalls;
        if (functionCalls?.length) {
          for (const call of functionCalls) {
            res.write(`data: ${JSON.stringify({ toolCall: { id: call.id, name: call.name, args: call.args || {} } })}\n\n`);
          }
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      console.error("Manager generation error:", err);
      res.write(`data: ${JSON.stringify({ error: err?.message || "Manager generation error" })}\n\n`);
      res.end();
    }
  });

  // REST API: Dedicated long-term-memory classifier.
  // This is intentionally separate from normal chat so memory decisions use the
  // lightweight model and never depend on the chat model/tool pipeline.
  app.post("/api/gemini/memory-classify", async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const { message, systemInstruction } = req.body;
    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    try {
      const runClassifier = async (model: string) => {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: message }] }],
          config: {
            systemInstruction: systemInstruction || "Decide whether this user message contains durable information worth remembering. Return JSON only.",
            responseMimeType: "application/json",
            temperature: 0,
          },
        });
        const raw = response.text || "";
        let result: any;
        try {
          result = JSON.parse(raw);
        } catch {
          const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
          result = JSON.parse(cleaned);
        }
        return result;
      };

      let result: any;
      try {
        result = await runClassifier(MEMORY_MODEL);
      } catch (primaryErr) {
        console.warn("Primary memory classifier failed; falling back to chat model:", primaryErr);
        result = await runClassifier("gemini-3.8-flash");
      }

      res.json(result);
    } catch (err: any) {
      console.error("Memory classification error:", err);
      res.status(500).json({ error: err?.message || "Memory classification error" });
    }
  });

  // REST API: Text Chat Endpoint (Streaming Server-Sent Events)
  app.post("/api/gemini/chat", async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const { message, systemInstruction, history, image } = req.body;
    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const contents: any[] = [];
      if (Array.isArray(history)) {
        history.forEach((h: any) => {
          contents.push({
            role: h.role === "user" ? "user" : "model",
            parts: [{ text: h.text }],
          });
        });
      }

      const userParts: any[] = [{ text: message }];
      if (image && image.data) {
        userParts.push({
          inlineData: {
            data: image.data,
            mimeType: image.mimeType || "image/jpeg",
          },
        });
      }

      contents.push({ role: "user", parts: userParts });

      const streamResponse = await ai.models.generateContentStream({
        model: "gemini-3.8-flash",
        contents,
        config: {
          systemInstruction: systemInstruction || JARVIS_SYSTEM_INSTRUCTION,
          // @ts-ignore
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          // @ts-ignore
          tools: [{ functionDeclarations: ALL_FUNCTION_DECLARATIONS }],
        },
      });

      for await (const chunk of streamResponse) {
        const text = chunk.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }

        // Check if chunk has functionCalls
        const functionCalls = chunk.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
          for (const call of functionCalls) {
            res.write(`data: ${JSON.stringify({ toolCall: { name: call.name, args: call.args } })}\n\n`);
          }
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      console.error("Chat generation error:", err);
      res.write(`data: ${JSON.stringify({ error: err?.message || "Generation error" })}\n\n`);
      res.end();
    }
  });

  // REST API: Text-to-Speech synthesis for text responses
  app.post("/api/gemini/tts", async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const { text, voice } = req.body;
    if (!text) {
      res.status(400).json({ error: "Text is required" });
      return;
    }

    const voiceName = getValidLiveVoice(voice || DEFAULT_VOICE);
    console.log(`[TTS Server] Synthesizing speech. Requested Voice: "${voice}" -> Valid Voice: "${voiceName}"`);

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: TTS_MODEL,
          contents: [{ role: "user", parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceName },
              },
            },
          },
        });
      } catch (primaryErr: any) {
        console.warn(`TTS primary model (${TTS_MODEL}) error, trying gemini-3.8-flash-tts:`, primaryErr?.message);
        response = await ai.models.generateContent({
          model: "gemini-3.8-flash-tts",
          contents: [{ role: "user", parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceName },
              },
            },
          },
        });
      }

      const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      res.json({ audio });
    } catch (err: any) {
      console.error("TTS generation error:", err);
      res.status(500).json({ error: err?.message || "TTS error" });
    }
  });

  // Mount Vite or serve static assets
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`JARVIS Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
