'use client'

import Link from 'next/link'
import { CheckCircle, XCircle, CreditCard, ArrowRight } from 'lucide-react'

export default function PaymentStatusBanner({
  payment,
  tripId,
}: {
  payment?: {
    id: string
    status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'ABANDONED'
    providerReference?: string | null
    failureReason?: string | null
    createdAt: Date
  } | null
  tripId?: string
}) {
  if (!payment) return null

  const isPending = payment.status === 'PENDING' || payment.status === 'ABANDONED'
  const isSuccess = payment.status === 'SUCCESSFUL'
  const isFailed = payment.status === 'FAILED'

  if (isSuccess) {
    return (
      <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">Payment confirmed</p>
            <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
              Your ride is ready to be matched. {tripId ? `Trip ${tripId.slice(0, 8)}…` : 'Your trip has been paid for.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (isFailed) {
    return (
      <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
        <div className="flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">Payment failed</p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
              {payment.failureReason
                ? `Reason: ${payment.failureReason}`
                : 'Your payment could not be completed.'}
            </p>
            <Link
              href={`/student/book?retry=${tripId || ''}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline mt-2"
            >
              Try again <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-2xl">
        <div className="flex items-start gap-3">
          <CreditCard className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
              {payment.status === 'PENDING' ? 'Payment pending' : 'Payment abandoned'}
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
              {payment.status === 'PENDING'
                ? 'We’re waiting for Flutterwave to confirm your payment. Do not close this page.'
                : 'Your payment was not completed. You can try again below.'}
            </p>
            <div className="flex items-center gap-3 mt-3">
              <Link
                href={`/api/payments/verify?reference=${encodeURIComponent(payment.providerReference || '')}`}
                className="text-xs font-medium text-[var(--primary)] hover:underline"
              >
                Check payment status
              </Link>
              {payment.status === 'ABANDONED' && (
                <Link
                  href="/student/book"
                  className="text-xs font-medium text-[var(--primary)] hover:underline"
                >
                  New booking
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}
