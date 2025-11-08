
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import JSZip from 'jszip';
import { PREBUILT_VOICES, TONES, Speaker, ScriptSegment, PrebuiltVoice, Tone } from './types';
import { decode, pcmToWav } from './utils/audio';

const DEFAULT_SCRIPT = `Director: Alright everyone, places! Scene 3, take 1.
Alice: Bob, I've found the treasure map! I'm so excited!
Bob: A map? Are you sure it's real? It looks ancient.
Charlie: Shh! Keep your voices down. We're not alone.
Alice: What do you mean? Who else is here?
Bob: I told you this was a bad idea. I'm getting a sad feeling about this.
Director: And... cut! That's a wrap for today, folks.`;

const tonePromptMap: Record<Tone, string> = {
  Neutral: '',
  Cheerful: 'Say cheerfully: ',
  Sad: 'Say sadly: ',
  Angry: 'Say angrily: ',
  Excited: 'Say with excitement: ',
};

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={`bg-gray-800/50 rounded-lg p-4 md:p-6 ${className}`}>{children}</div>
);

export default function App() {
  const [scriptText, setScriptText] = useState(DEFAULT_SCRIPT);
  const [speakers, setSpeakers] = useState<Record<string, Speaker>>({});
  const [segments, setSegments] = useState<ScriptSegment[]>([]);
  const [generatedAudios, setGeneratedAudios] = useState<Map<number, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY as string }), []);

  // Effect to clean up object URLs when the component unmounts
  useEffect(() => {
    return () => {
      generatedAudios.forEach(url => URL.revokeObjectURL(url));
    };
  }, [generatedAudios]);


  useEffect(() => {
    const lines = scriptText.split('\n').filter(line => line.trim() !== '');
    const newSegments: ScriptSegment[] = [];
    const newSpeakerNames = new Set<string>();

    lines.forEach((line, index) => {
      const match = line.match(/^(.+?):\s*(.*)$/);
      if (match) {
        const [, speakerName, text] = match;
        const trimmedSpeakerName = speakerName.trim();
        if (trimmedSpeakerName) {
            newSpeakerNames.add(trimmedSpeakerName);
            newSegments.push({
                id: index,
                speakerName: trimmedSpeakerName,
                text: text.trim(),
                tone: 'Neutral',
            });
        }
      }
    });

    // FIX: Add explicit types to state setter callbacks to resolve type inference issues.
    setSegments((prevSegments: ScriptSegment[]) => {
      const segmentMap = new Map(prevSegments.map(s => [s.id, s]));
      return newSegments.map(newSeg => ({
        ...newSeg,
        tone: segmentMap.get(newSeg.id)?.tone || 'Neutral',
      }));
    });

    // FIX: Add explicit types to state setter callbacks to resolve type inference issues.
    setSpeakers((prevSpeakers: Record<string, Speaker>) => {
      const nextSpeakers: Record<string, Speaker> = {};
      const speakerNamesArray = Array.from(newSpeakerNames);
      
      Object.values(prevSpeakers).forEach(speaker => {
        if (newSpeakerNames.has(speaker.name)) {
          nextSpeakers[speaker.name] = speaker;
        }
      });
      
      speakerNamesArray.forEach((name, i) => {
        if (!nextSpeakers[name]) {
          nextSpeakers[name] = {
            name,
            voice: PREBUILT_VOICES[i % PREBUILT_VOICES.length],
          };
        }
      });
      return nextSpeakers;
    });

  }, [scriptText]);

  const handleSpeakerVoiceChange = (name: string, voice: PrebuiltVoice) => {
    setSpeakers(prev => ({
      ...prev,
      [name]: { ...prev[name], voice },
    }));
  };

  const handleSpeakerNameChange = (oldName: string, newName: string) => {
    const trimmedNewName = newName.trim();
    if (!trimmedNewName || oldName === trimmedNewName || speakers[trimmedNewName]) {
      // Ignore invalid or duplicate names
      return;
    }

    const newScriptText = scriptText
      .split('\n')
      .map(line => {
        // Match "Speaker:" at the start of a line, allowing for leading/trailing whitespace around name
        const pattern = new RegExp(`^(\\s*)${oldName}(\\s*:)`);
        if (pattern.test(line)) {
          return line.replace(pattern, `$1${trimmedNewName}$2`);
        }
        return line;
      })
      .join('\n');

    setScriptText(newScriptText);
  };

  const handleSegmentToneChange = (id: number, tone: Tone) => {
    setSegments(prev => prev.map(seg => seg.id === id ? { ...seg, tone } : seg));
  };

  const handleGenerateAudio = useCallback(async () => {
    if (segments.length === 0 || Object.keys(speakers).length === 0) {
      setError("Script is empty or not formatted correctly. Use 'Speaker: text' format.");
      return;
    }
    
    setIsLoading(true);
    setError(null);

    // Revoke any existing audio URLs to prevent memory leaks
    generatedAudios.forEach(url => URL.revokeObjectURL(url));
    const newAudios = new Map<number, string>();
    const newBlobs = new Map<number, Blob>();


    try {
      let audiosGenerated = 0;
      for (const seg of segments) {
        const speaker = speakers[seg.speakerName];
        if (!speaker) continue;

        const tonePrefix = tonePromptMap[seg.tone];
        const prompt = `${tonePrefix}${seg.text}`;
        
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: speaker.voice }
              }
            }
          }
        });
        
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            const pcmData = decode(base64Audio);
            const wavBlob = pcmToWav(pcmData, 24000, 1, 16);
            const url = URL.createObjectURL(wavBlob);
            newAudios.set(seg.id, url);
            newBlobs.set(seg.id, wavBlob);
            audiosGenerated++;
        }
      }
      
      setGeneratedAudios(newAudios);

      if (audiosGenerated === 0) {
        throw new Error("No audio data was generated. Check API key and script format.");
      }
      
      // Zip and download all generated files
      if (newBlobs.size > 0) {
        const zip = new JSZip();
        const segmentsMap = new Map<number, ScriptSegment>(segments.map(s => [s.id, s]));

        for (const [id, blob] of newBlobs.entries()) {
            const segment = segmentsMap.get(id);
            if (segment) {
                const filename = `${segment.id}_${segment.speakerName.replace(/\s+/g, '_')}.wav`;
                zip.file(filename, blob);
            }
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = 'script_audio_clips.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      }

    } catch (e) {
      console.error(e);
      let errorMessage = "An unknown error occurred.";
      if (e instanceof Error) {
          errorMessage = e.message;
          // Provide a more helpful message for the specific XHR error
          if (errorMessage.includes("Rpc failed due to xhr error")) {
              errorMessage = "A network error occurred while communicating with the API. Please check your connection and try again.";
          }
      }
      setError(errorMessage);
       // Clean up any partially generated audio URLs on error
      newAudios.forEach(url => URL.revokeObjectURL(url));
    } finally {
      setIsLoading(false);
    }
  }, [ai, segments, speakers, generatedAudios]);
  
  const speakerList = Object.values(speakers);

  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-gray-100 font-sans p-4 md:p-6">
      <header className="text-center mb-6">
        <h1 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          Multi-Voice Script Voicer
        </h1>
        <p className="text-gray-400 mt-2">Bring your scripts to life with customizable AI voices and tones.</p>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="text-xl font-semibold mb-3 text-blue-300">1. Write Your Script</h2>
            <textarea
              value={scriptText}
              onChange={e => setScriptText(e.target.value)}
              placeholder="Enter script here, e.g., Speaker: Dialogue..."
              className="w-full h-48 p-3 bg-gray-900 border border-gray-700 rounded-md resize-y focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-2">Format each line as <code className="bg-gray-700 p-1 rounded">Speaker Name: Text</code>.</p>
          </Card>
          <Card>
            <h2 className="text-xl font-semibold mb-3 text-purple-300">2. Configure Voices</h2>
            {speakerList.length > 0 ? (
                <div className="space-y-3">
                  {/* FIX: Explicitly type `speaker` to resolve type inference issues. */}
                  {speakerList.map((speaker: Speaker) => (
                    <div key={speaker.name} className="flex items-center justify-between gap-4">
                      <input
                        type="text"
                        defaultValue={speaker.name}
                        onBlur={e => handleSpeakerNameChange(speaker.name, e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                            }
                        }}
                        aria-label={`Edit name for ${speaker.name}`}
                        className="bg-gray-700 border border-gray-600 rounded-md px-3 py-1 text-sm w-36 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      />
                      <select
                        value={speaker.voice}
                        onChange={e => handleSpeakerVoiceChange(speaker.name, e.target.value as PrebuiltVoice)}
                        aria-label={`Select voice for ${speaker.name}`}
                        className="bg-gray-700 border border-gray-600 rounded-md px-3 py-1 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      >
                        {PREBUILT_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">Speakers will appear here once detected in your script.</p>
            )}
          </Card>
        </div>
        <div className="flex flex-col">
            <Card className="flex-1">
              <h2 className="text-xl font-semibold mb-3 text-green-300">3. Set The Tone &amp; Listen</h2>
              <div className="space-y-2 max-h-[calc(100vh-20rem)] overflow-y-auto pr-2">
              {segments.length > 0 ? (
                segments.map(segment => (
                  <div key={segment.id} className="p-3 bg-gray-900/70 rounded-md">
                    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
                        <strong className="text-blue-400">{segment.speakerName}:</strong>
                        <p className="text-gray-300 truncate" title={segment.text}>"{segment.text}"</p>
                        <select
                          value={segment.tone}
                          onChange={e => handleSegmentToneChange(segment.id, e.target.value as Tone)}
                          className="bg-gray-700 border border-gray-600 rounded-md px-3 py-1 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                        >
                          {TONES.map(tone => <option key={tone} value={tone}>{tone}</option>)}
                        </select>
                    </div>
                    {generatedAudios.get(segment.id) && (
                        <div className="mt-3 flex items-center gap-3">
                            <audio controls src={generatedAudios.get(segment.id)} className="w-full h-8 flex-1">
                                Your browser does not support the audio element.
                            </audio>
                             <a
                                href={generatedAudios.get(segment.id)}
                                download={`${segment.id}_${segment.speakerName.replace(/\s+/g, '_')}.wav`}
                                className="flex-shrink-0 p-2 rounded-full bg-green-600 hover:bg-green-700 transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-green-500"
                                aria-label={`Download audio for ${segment.speakerName}`}
                                title="Download audio"
                            >
                                <svg className="h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                            </a>
                        </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-8">Script breakdown will appear here.</p>
              )}
              </div>
            </Card>
        </div>
      </main>

      <footer className="w-full max-w-7xl mx-auto mt-6">
        <Card>
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-4">
                <button
                onClick={handleGenerateAudio}
                disabled={isLoading || segments.length === 0}
                className="px-8 py-3 text-lg font-bold rounded-full transition-all duration-300 ease-in-out shadow-lg focus:outline-none focus:ring-4 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white disabled:from-gray-600 disabled:to-gray-700"
                >
                {isLoading ? 'Generating Audio...' : 'Generate & Download Audio'}
                </button>
            </div>
            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
          </div>
        </Card>
      </footer>
    </div>
  );
}
