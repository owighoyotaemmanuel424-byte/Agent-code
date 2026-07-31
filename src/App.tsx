/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Activity, Database, Key, LayoutTemplate } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Navigation Bar */}
      <nav className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white">
            <LayoutTemplate className="w-5 h-5" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Supabase Dev Env</span>
        </div>
        <div className="flex items-center space-x-4 text-sm font-medium text-slate-600">
          <a href="#" className="hover:text-indigo-600 transition-colors">Documentation</a>
          <a href="#" className="hover:text-indigo-600 transition-colors">GitHub</a>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-2">
            Dashboard Overview
          </h1>
          <p className="text-slate-500 max-w-2xl text-base sm:text-lg">
            Monitor your application's connection status to backend services.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Auth Status Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Key className="w-5 h-5" />
                </div>
                <h2 className="font-semibold text-lg">Authentication</h2>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                <Activity className="w-3 h-3 mr-1" /> Pending
              </span>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-center">
              <p className="text-slate-500 text-sm mb-4">
                User authentication is currently pending configuration. Connect your Supabase project to enable secure sign-ins.
              </p>
              <button className="mt-auto w-full inline-flex justify-center items-center px-4 py-2 border border-slate-300 shadow-sm text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors">
                Configure Auth
              </button>
            </div>
          </div>

          {/* Database Status Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Database className="w-5 h-5" />
                </div>
                <h2 className="font-semibold text-lg">Database Connection</h2>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                <Activity className="w-3 h-3 mr-1" /> Unconnected
              </span>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-center">
              <div className="space-y-3 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Host</span>
                  <span className="font-mono text-slate-700">db.cetid...</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Status</span>
                  <span className="font-mono text-slate-700">Waiting</span>
                </div>
              </div>
              <button className="mt-auto w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors">
                Test Connection
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
