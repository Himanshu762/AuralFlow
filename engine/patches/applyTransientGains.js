    /**
     * Apply band gains to the running filters without saving them.
     *
     * AuralFlow's adaptive EQ recomputes a correction curve several times a
     * second from the live analyser. Routing that through `setAllGains` would
     * write the whole curve to localStorage on every update — a synchronous
     * write in the audio path — and would overwrite the EQ the user set by
     * hand. This applies the curve to the graph only; what the user chose
     * stays on disk untouched, and is restored by re-applying it.
     *
     * @param {number[]} gains - one value in dB per band
     * @param {number} [rampSeconds=0.08] - smoothing constant, longer is gentler
     */
    applyTransientGains(gains, rampSeconds = 0.08) {
        if (!Array.isArray(gains) || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        const count = Math.min(gains.length, this.bandCount);

        for (let i = 0; i < count; i++) {
            const value = this._clampGain(Number(gains[i]) || 0);
            /* Mid/side mode splits the chain in two; both sides carry the
               same correction so the stereo image is unchanged. */
            for (const chain of [this.filters, this.midFilters, this.sideFilters]) {
                const filter = chain?.[i];
                if (filter) filter.gain.setTargetAtTime(value, now, rampSeconds);
            }
        }
    }
