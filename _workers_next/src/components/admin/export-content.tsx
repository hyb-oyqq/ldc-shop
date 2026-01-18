'use client'

import { useState } from "react"
import { useI18n } from "@/lib/i18n/context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Download, Upload, FileUp, AlertCircle, CheckCircle2 } from "lucide-react"
import { importData } from "@/actions/data"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

function downloadUrl(params: Record<string, string>) {
  const search = new URLSearchParams(params)
  // Ensure we point to the correct download API
  return `/admin/export/download?${search.toString()}`.replace('/export/', '/data/')
}

export function AdminDataContent({ shopName }: { shopName: string | null }) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ count: number, errors: number } | null>(null)

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const file = formData.get('file') as File

    if (!file || file.size === 0) {
      toast.error(t('common.error'))
      return
    }

    setImporting(true)
    setImportResult(null)

    try {
      const result = await importData(formData)
      if (result.success) {
        // Fix: ensure numbers are treated as numbers
        const count = typeof result.count === 'number' ? result.count : 0
        const errors = typeof result.errors === 'number' ? result.errors : 0
        setImportResult({ count, errors })
        toast.success(t('admin.export.importSuccess', { count, errors }))
        form?.reset()
      } else {
        toast.error(result.error || t('common.error'))
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('admin.export.title').replace('Export', 'Management').replace('导出', '管理')}</h1>
        <p className="text-sm text-muted-foreground mt-2">{t('admin.export.subtitle')}</p>
      </div>

      <div className="w-full">
        {/* Custom Tabs List */}
        <div className="flex space-x-1 rounded-lg bg-muted p-1">
          <button
            onClick={() => setActiveTab('export')}
            className={cn(
              "flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              activeTab === 'export' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted-foreground/10"
            )}
          >
            {t('admin.export.tabExport')}
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={cn(
              "flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              activeTab === 'import' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted-foreground/10"
            )}
          >
            {t('admin.export.tabImport')}
          </button>
        </div>

        {/* Export Tab Content */}
        {activeTab === 'export' && (
          <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" />{t('admin.export.orders')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "orders", format: "csv" })}>{t('admin.export.csv')}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "orders", format: "json" })}>{t('admin.export.json')}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "orders", format: "csv", includeSecrets: "1" })}>{t('admin.export.csvWithSecrets')}</a>
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" />{t('admin.export.products')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "products", format: "json" })}>{t('admin.export.json')}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "products", format: "csv" })}>{t('admin.export.csv')}</a>
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" />{t('admin.export.reviews')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "reviews", format: "csv" })}>{t('admin.export.csv')}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "reviews", format: "json" })}>{t('admin.export.json')}</a>
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" />{t('admin.export.settings')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "settings", format: "json" })}>{t('admin.export.json')}</a>
                  </Button>
                  {shopName && (
                    <p className="text-xs text-muted-foreground w-full mt-2">
                      {t('admin.export.currentShopName')}: <span className="font-medium text-foreground">{shopName}</span>
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" />{t('admin.export.fullDump')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "full", format: "json" })}>{t('admin.export.json')}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={downloadUrl({ type: "full", format: "sql" })}>{t('admin.export.d1Sql')}</a>
                  </Button>
                  <p className="text-xs text-muted-foreground w-full mt-2">{t('admin.export.fullDumpHint')}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Import Tab Content */}
        {activeTab === 'import' && (
          <div className="mt-6 animate-in fade-in slide-in-from-top-1 duration-200">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" />{t('admin.export.importTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('admin.export.importDesc')}</p>

                {importResult && (
                  <div className={cn("flex w-full items-center gap-3 rounded-lg border p-4 text-sm", importResult.errors > 0 ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200" : "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200")}>
                    {importResult.errors > 0 ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    <div className="font-medium">
                      {importResult.errors === 0 ? t('common.success') : t('common.error')}
                    </div>
                    <div className="text-xs opacity-90">
                      {t('admin.export.importSuccess', { count: importResult.count, errors: importResult.errors })}
                    </div>
                  </div>
                )}

                <form onSubmit={handleImport} className="grid w-full max-w-sm items-center gap-1.5 space-y-4">
                  <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="sql-file">{t('admin.export.selectFile')}</Label>
                    <Input id="sql-file" name="file" type="file" accept=".sql,.txt" required />
                  </div>
                  <Button type="submit" disabled={importing}>
                    {importing ? (
                      <>
                        <Upload className="mr-2 h-4 w-4 animate-bounce" />
                        {t('admin.export.importing')}
                      </>
                    ) : (
                      <>
                        <FileUp className="mr-2 h-4 w-4" />
                        {t('admin.export.importBtn')}
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
