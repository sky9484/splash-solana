'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

export default function SplashLoading({ label = 'Loading your dashboard' }: { label?: string }) {
  return (
    <div className="splash-loading-shell">
      <div className="splash-loading-grid" aria-hidden="true" />
      <div className="splash-loading-panel">
        <div className="splash-loading-route" aria-hidden="true">
          <motion.i animate={{ left: ['5%', '86%'] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }} />
          <span>USDC</span><span>SOLANA</span><span>LOCAL</span>
        </div>
        <motion.div
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          className="splash-loading-art"
        >
          <Image src="/cinematic/settlement-machine.png" alt="" width={2752} height={1536} priority />
        </motion.div>
        <div className="splash-loading-copy">
          <Image src="/splash-main-icon.png" alt="" width={48} height={47} priority />
          <span>
            <motion.strong animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
              {label}
            </motion.strong>
            <small>Preparing settlement, treasury, and proof</small>
          </span>
        </div>
      </div>
    </div>
  );
}
