/**
 * Bottom Input Bar component for JARVIS.
 * Provides text input with Enter-to-send, quick microphone toggle,
 * attachment (+), and text send button. Works seamlessly even if microphone access is denied.
 */

import React, { useState, useRef } from "react";
import { Mic, ArrowUp, Plus, X } from "lucide-react";
import { AssistantState } from "../types/assistant";

interface InputBarProps {
  onSendMessage: (text: string, image?: { data: string; mimeType: string }) => void;
  onToggleMic: () => void;
  isMicActive: boolean;
  state: AssistantState;
  disabled?: boolean;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSendMessage,
  onToggleMic,
  isMicActive,
  state,
  disabled = false,
}) => {
  const [text, setText] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if ((!text.trim() && !attachedFile) || disabled) return;
    
    const currentText = text.trim();
    const currentFile = attachedFile;

    // Reset input fields immediately to keep UI response instantaneous
    setText("");
    setAttachedFile(null);
    setAttachedPreview(null);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    if (currentFile && currentFile.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        const resultString = reader.result as string;
        // Extract raw base64 data from DataURL
        const base64Data = resultString.split(",")[1];
        onSendMessage(currentText, {
          data: base64Data,
          mimeType: currentFile.type,
        });
      };
      reader.onerror = () => {
        onSendMessage(currentText);
      };
      reader.readAsDataURL(currentFile);
    } else {
      let finalMessage = currentText;
      if (currentFile) {
        finalMessage = `[File: ${currentFile.name}] ${finalMessage}`.trim();
      }
      onSendMessage(finalMessage);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    // Defer the textarea measurement so the Android IME animation is not
    // forced to perform a synchronous layout read/write on the same frame.
    requestAnimationFrame(() => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    });
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAttachedFile(file);

      // Create an image preview if file is an image
      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        setAttachedPreview(url);
      } else {
        setAttachedPreview(null);
      }
    }
  };

  const handleRemoveAttachment = () => {
    if (attachedPreview) {
      URL.revokeObjectURL(attachedPreview);
    }
    setAttachedFile(null);
    setAttachedPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-2 sm:pb-4 select-none">
      {/* File Attachment Capsule Sitting Above Text Area */}
      {attachedFile && (
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-[11px] font-mono text-[#00ffaa] animate-fadeIn select-none mb-2 w-max max-w-full">
          {attachedPreview ? (
            <img
              src={attachedPreview}
              alt="Attachment preview"
              className="w-8 h-8 rounded-md object-cover border border-[#00ffaa]/20 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-md bg-white/[0.05] border border-white/[0.1] flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-neutral-500">FILE</span>
            </div>
          )}
          <div className="flex flex-col min-w-0 pr-1">
            <span className="truncate max-w-[120px] font-medium text-white">{attachedFile.name}</span>
            <span className="text-[9px] text-neutral-500 font-sans">{(attachedFile.size / 1024).toFixed(1)} KB</span>
          </div>
          <button
            type="button"
            onClick={handleRemoveAttachment}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors text-neutral-400 hover:text-rose-400 cursor-pointer shrink-0"
            aria-label="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-1.5 p-1.5 rounded-2xl sm:rounded-3xl bg-[#0f1214] border border-white/[0.08] focus-within:border-[#00ffaa]/50 focus-within:ring-1 focus-within:ring-[#00ffaa]/30 transition-all duration-200 shadow-xl">
        {/* Hidden Native File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Attachment Button */}
        <button
          onClick={triggerFileSelect}
          type="button"
          disabled={disabled}
          aria-label="Attach file"
          className="p-2.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Attach file"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Quick Microphone Button */}
        <button
          onClick={onToggleMic}
          type="button"
          aria-label={isMicActive ? "Mute microphone" : "Enable microphone"}
          className={`p-2.5 rounded-xl transition-all cursor-pointer ${
            isMicActive
              ? "bg-[#00ffaa]/15 text-[#00ffaa] border border-[#00ffaa]/30 shadow-[0_0_10px_rgba(0,255,170,0.2)]"
              : "text-neutral-400 hover:text-white hover:bg-white/[0.06]"
          }`}
          title={isMicActive ? "Deactivate voice mode" : "Activate voice mode"}
        >
          <Mic className="w-4 h-4" />
        </button>

        {/* Text Input */}
        <textarea
          ref={inputRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message JARVIS..."
          rows={1}
          disabled={disabled}
          className="flex-1 max-h-[120px] py-2 px-1 bg-transparent text-sm text-[#e6e8eb] placeholder-neutral-500 focus:outline-none resize-none font-sans leading-relaxed"
        />

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={(!text.trim() && !attachedFile) || disabled}
          type="button"
          aria-label="Send message"
          className={`p-2.5 rounded-xl transition-all cursor-pointer ${
            (text.trim() || attachedFile) && !disabled
              ? "bg-[#00ffaa] text-black hover:bg-[#00e599] active:scale-95 shadow-md shadow-[#00ffaa]/20"
              : "text-neutral-600 bg-white/[0.03] cursor-not-allowed"
          }`}
        >
          <ArrowUp className="w-4 h-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
