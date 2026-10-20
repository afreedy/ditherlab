import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-300.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import './styles.css'
import './body-editor.css'
import BodyEditor from './BodyEditor.jsx'

createRoot(document.getElementById('root')).render(<BodyEditor />)
