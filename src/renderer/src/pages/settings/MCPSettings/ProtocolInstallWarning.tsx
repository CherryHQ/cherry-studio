import React from 'react'

interface ProtocolInstallWarningContentProps {
  message: string
  commandLabel: string
  commandPreview: string
}

/**
 * Warning content component for protocol-installed MCP servers
 * Displays a security warning and the command that will be executed
 */
const ProtocolInstallWarningContent: React.FC<ProtocolInstallWarningContentProps> = ({
  message,
  commandLabel,
  commandPreview
}) => {
  return (
    <div className="space-y-3 text-left">
      <p>{message}</p>
      {commandPreview && (
        <div className="space-y-1">
          <div className="font-semibold">{commandLabel}</div>
          <pre className="whitespace-pre-wrap break-all rounded-md bg-[var(--color-fill-secondary)] p-2">
            {commandPreview}
          </pre>
        </div>
      )}
    </div>
  )
}

export default ProtocolInstallWarningContent
