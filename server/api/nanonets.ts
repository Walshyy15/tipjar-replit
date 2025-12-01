import fetch, { FormData } from 'node-fetch';
import { OCR_RATE_LIMIT_CONFIG, isRateLimitError } from '../config/rate-limit';

const NANONETS_EXTRACTION_ENDPOINT = 'https://app.nanonets.com/api/v2/OCR/FullText';

// Simple in-memory rate limiter
class RateLimiter {
    private requests: number[] = [];
    private readonly maxRequests: number;
    private readonly windowMs: number;

    constructor(
        maxRequests: number = OCR_RATE_LIMIT_CONFIG.maxRequests,
        windowMs: number = OCR_RATE_LIMIT_CONFIG.windowMs,
    ) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
    }

    canMakeRequest(): boolean {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);

        if (this.requests.length >= this.maxRequests) {
            return false;
        }

        this.requests.push(now);
        return true;
    }

    getTimeUntilNextRequest(): number {
        if (this.requests.length < this.maxRequests) {
            return 0;
        }

        const oldestRequest = Math.min(...this.requests);
        return Math.max(0, this.windowMs - (Date.now() - oldestRequest));
    }
}

const rateLimiter = new RateLimiter();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function extractTextFromNanonets(responseData: any): string | null {
    const texts: string[] = [];

    const collectFromNode = (node: any) => {
        if (!node) return;

        if (typeof node === 'string') {
            texts.push(node);
            return;
        }

        if (typeof node.text === 'string') texts.push(node.text);
        if (typeof node.ocr_text === 'string') texts.push(node.ocr_text);
        if (typeof node.fullText === 'string') texts.push(node.fullText);

        const arrays = [
            node.result,
            node.results,
            node.predictions,
            node.fields,
            node.pages,
            node.page_data,
            node.lines,
        ];

        arrays.forEach(collection => {
            if (Array.isArray(collection)) {
                collection.forEach(collectFromNode);
            }
        });
    };

    collectFromNode(responseData);
    const combined = texts.map(text => text.trim()).filter(Boolean).join('\n').trim();
    return combined || null;
}

export async function analyzeImage(
    imageBase64: string,
    mimeType: string = 'image/jpeg',
    apiKey?: string,
    modelId?: string,
): Promise<{ text: string | null; error?: string }> {
    // Local rate limit (before even calling Nanonets)
    if (!rateLimiter.canMakeRequest()) {
        const waitTime = rateLimiter.getTimeUntilNextRequest();
        return {
            text: null,
            error: OCR_RATE_LIMIT_CONFIG.messages.rateLimitExceeded(waitTime),
        };
    }

    const nanonetsKey = apiKey || process.env.NANONETS_API_KEY || '';
    if (!nanonetsKey) {
        return {
            text: null,
            error: 'API key missing. Please configure the Nanonets API key.',
        };
    }

    // modelId is not needed for the FullText endpoint, but kept for backward compatibility
    void modelId;

    for (let attempt = 0; attempt <= OCR_RATE_LIMIT_CONFIG.maxRetries; attempt++) {
        try {
            const formData = new FormData();
            const buffer = Buffer.from(imageBase64, 'base64');
            const extension = mimeType.split('/')[1] || 'jpg';

            // Using Blob keeps this close to your original implementation.
            const fileBlob = new Blob([buffer], { type: mimeType });
            formData.append('file', fileBlob as any, `upload.${extension}`);

            const response = await fetch(NANONETS_EXTRACTION_ENDPOINT, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${Buffer.from(`${nanonetsKey}:`).toString('base64')}`,
                },
                body: formData as any,
            });

            if (!response.ok) {
                const errorText = await response.text();
                const shouldRetry = isRateLimitError({ code: response.status, message: errorText });

                if (shouldRetry && attempt < OCR_RATE_LIMIT_CONFIG.maxRetries) {
                    const delay = Math.min(
                        OCR_RATE_LIMIT_CONFIG.baseDelay *
                            Math.pow(OCR_RATE_LIMIT_CONFIG.backoffMultiplier, attempt),
                        OCR_RATE_LIMIT_CONFIG.maxDelay,
                    );
                    console.log(
                        `Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${
                            OCR_RATE_LIMIT_CONFIG.maxRetries + 1
                        })`,
                    );
                    await sleep(delay);
                    continue;
                }

                console.error('Nanonets API error:', response.status, errorText);

                // Try to parse Nanonets' structured error JSON to surface a friendly message
                let friendlyMessage: string | null = null;
                try {
                    const parsed = JSON.parse(errorText);
                    if (parsed && typeof parsed === 'object') {
                        const anyParsed = parsed as any;

                        if (typeof anyParsed.message === 'string') {
                            friendlyMessage = anyParsed.message;
                        } else if (Array.isArray(anyParsed.errors) && anyParsed.errors.length > 0) {
                            const firstError = anyParsed.errors[0];
                            if (firstError) {
                                if (typeof firstError.message === 'string') {
                                    friendlyMessage = firstError.message;
                                } else if (typeof firstError.reason === 'string') {
                                    friendlyMessage = firstError.reason;
                                }
                            }
                        }
                    }
                } catch {
                    // Not JSON; fall back to raw text below.
                }

                const baseMessage =
                    friendlyMessage ||
                    (errorText && errorText.trim()) ||
                    'Failed to call Nanonets OCR API';
                const sanitizedError = baseMessage.slice(0, 500);

                return {
                    text: null,
                    error: `API Error (${response.status}): ${sanitizedError}`,
                };
            }

            const data = await response.json();
            const extractedText = extractTextFromNanonets(data);

            if (!extractedText) {
                return {
                    text: null,
                    error: 'No text extracted from the image. Try a clearer image or manual entry.',
                };
            }

            return { text: extractedText };
        } catch (error: any) {
            if (attempt === OCR_RATE_LIMIT_CONFIG.maxRetries) {
                console.error('Error calling Nanonets OCR (final attempt):', error);
                return {
                    text: null,
                    error: 'An unexpected error occurred while processing the image.',
                };
            }

            const delay = Math.min(
                OCR_RATE_LIMIT_CONFIG.baseDelay *
                    Math.pow(OCR_RATE_LIMIT_CONFIG.backoffMultiplier, attempt),
                OCR_RATE_LIMIT_CONFIG.maxDelay,
            );
            console.log(
                `Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${
                    OCR_RATE_LIMIT_CONFIG.maxRetries + 1
                }):`,
                error,
            );
            await sleep(delay);
        }
    }

    return {
        text: null,
        error: OCR_RATE_LIMIT_CONFIG.messages.maxRetriesExceeded,
    };
}
