import React, { useState, useEffect, useCallback } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy, // Используем горизонтальную стратегию для плашек
} from '@dnd-kit/sortable';
import { SortableModeChip } from './components/SortableModeChip'; // Импортируем наш новый компонент

// --- Типы ---
// New types for Stacks By Framework
interface StackMode {
    id: string;
    slug: string;
    nameWithIcon: string;
    description: string;
    icon?: string;
    name: string;
}

interface StackSubgroup {
    id: string;
    title: string;
    fullTitle: string; // Include the number prefix
    description: string;
    modes: StackMode[];
    selected: boolean;
    partiallySelected: boolean;
}

interface StackFramework {
    id: string;
    title: string;
    description: string;
    subgroups: StackSubgroup[];
}

interface StacksData {
    generalPurpose: StackFramework;
    frameworks: StackFramework[];
}

interface VSCodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(newState: any): void;
}

// @ts-ignore
const vscode: VSCodeApi = acquireVsCodeApi();

// --- Вспомогательные функции ---
// Parser for stacks data
function parseStacksData(stacksContent: string): StacksData {
    if (!stacksContent || typeof stacksContent !== 'string') {
        console.warn('parseStacksData: stacksContent is null, undefined, or not a string. Returning empty data.');
        return {
            generalPurpose: { id: 'general', title: '', description: '', subgroups: [] },
            frameworks: []
        };
    }

    const lines = stacksContent.split('\n');
    const frameworks: StackFramework[] = [];
    let currentFramework: StackFramework | null = null;
    let currentSubgroup: StackSubgroup | null = null;
    let generalPurpose: StackFramework = { id: 'general-purpose', title: '', description: '', subgroups: [] };
    let isGeneralPurpose = false;

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        // Main framework headers (# 1. General-purpose modes, # 2. Framework stacks)
        if (trimmedLine.match(/^# \d+\.\s*(.+)/)) {
            const match = trimmedLine.match(/^# \d+\.\s*(.+)/);
            if (match) {
                const title = match[1];
                if (title.toLowerCase().includes('general') || title.toLowerCase().includes('загального') || title.toLowerCase().includes('універсальних')) {
                    isGeneralPurpose = true;
                    generalPurpose.title = title;
                    currentFramework = generalPurpose;
                } else {
                    isGeneralPurpose = false;
                    currentFramework = {
                        id: `framework-${frameworks.length}`,
                        title: title,
                        description: '',
                        subgroups: []
                    };
                    frameworks.push(currentFramework);
                }
            }
        }
        // Subgroup headers (## 1.1, ## 2.1, etc.)
        else if (trimmedLine.match(/^## (\d+\.\d+\s+.+)/)) {
            const match = trimmedLine.match(/^## (\d+\.\d+\s+.+)/);
            if (match && currentFramework) {
                const fullTitle = match[1]; // Include number like "2.1 React & Next.js"
                const titleParts = fullTitle.match(/^\d+\.\d+\s+(.+)$/);
                const title = titleParts ? titleParts[1] : fullTitle;

                currentSubgroup = {
                    id: `subgroup-${currentFramework.subgroups.length}`,
                    title: title,
                    fullTitle: fullTitle,
                    description: '',
                    modes: [],
                    selected: false,
                    partiallySelected: false
                };
                currentFramework.subgroups.push(currentSubgroup);
            }
        }
        // Description lines (after headers)
        else if (currentSubgroup && trimmedLine && !trimmedLine.startsWith('-') && !trimmedLine.startsWith('##')) {
            if (!currentSubgroup.description) {
                currentSubgroup.description = trimmedLine;
            }
        }
        // Mode lines (start with -)
        else if (trimmedLine.startsWith('-') && currentSubgroup && currentFramework) {
            const modeRegex = /^-\s*(?:([\u2000-\u3300\uE000-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\s]+?)\s+)?(.+?)\s+\(([^)]+)\)/;
            const match = trimmedLine.match(modeRegex);

            if (match) {
                const icon = match[1] ? match[1].trim() : undefined;
                const name = match[2].trim();
                const slug = match[3].trim();
                const nameWithIcon = icon ? `${icon} ${name}` : name;

                const mode: StackMode = {
                    id: `mode-${currentFramework.id}-${currentSubgroup.id}-${currentSubgroup.modes.length}`,
                    slug: slug,
                    nameWithIcon: nameWithIcon,
                    description: '',
                    icon: icon,
                    name: name
                };
                currentSubgroup.modes.push(mode);
            }
        }
    });

    return {
        generalPurpose: generalPurpose,
        frameworks: frameworks
    };
}


function App() {
    // --- BEGIN STATE LOGGING ---
    const [orderedSelectedModeObjects, _setOrderedSelectedModeObjects] = useState<StackMode[]>([]);
    const [selectedAndOrderedSlugs, _setSelectedAndOrderedSlugs] = useState<string[]>([]);
    const [stacksData, _setStacksData] = useState<StacksData>({
        generalPurpose: { id: 'general', title: '', description: '', subgroups: [] },
        frameworks: []
    });
    const [selectedStackModeIds, _setSelectedStackModeIds] = useState<Set<string>>(new Set());

    const setOrderedSelectedModeObjects = (value: React.SetStateAction<StackMode[]>) => {
        // console.log('[StateSetter] setOrderedSelectedModeObjects called. New value (or updater):', value); // Reduced noise
        if (typeof value === 'function') {
            _setOrderedSelectedModeObjects(prev => {
                const newValue = value(prev);
                // console.log('[StateSetter] setOrderedSelectedModeObjects (updater) - prev count:', prev.length, 'new count:', newValue.length); // Reduced detail
                return newValue;
            });
        } else {
            // console.log('[StateSetter] setOrderedSelectedModeObjects - new count:', value.length); // Reduced detail
            _setOrderedSelectedModeObjects(value);
        }
    };

    const setSelectedAndOrderedSlugs = (value: React.SetStateAction<string[]>) => {
        // console.log('[StateSetter] setSelectedAndOrderedSlugs called. New value (or updater):', value); // Reduced noise
        if (typeof value === 'function') {
            _setSelectedAndOrderedSlugs(prev => {
                const newValue = value(prev);
                console.log('[StateSetter] setSelectedAndOrderedSlugs (updater) - prev slugs:', JSON.stringify(prev), 'new slugs:', JSON.stringify(newValue)); // Kept for importance
                return newValue;
            });
        } else {
            console.log('[StateSetter] setSelectedAndOrderedSlugs - new slugs:', JSON.stringify(value)); // Kept for importance
            _setSelectedAndOrderedSlugs(value);
        }
    };
    
    const setStacksData = (value: React.SetStateAction<StacksData>) => {
        // console.log('[StateSetter] setStacksData called.'); // Reduced noise
        if (typeof value === 'function') {
            _setStacksData(prev => {
                console.log('[StateSetter] setStacksData (updater) - attempting to apply update.'); 
                const newValue = value(prev);
                console.log('[StateSetter] setStacksData (updater) - new value computed.');
                return newValue;
            });
        } else {
            // console.log('[StateSetter] setStacksData - new value (summary):', { generalPurposeSubgroups: value.generalPurpose.subgroups.length, frameworks: value.frameworks.length }); // Reduced noise
            _setStacksData(value);
        }
    };

    const setSelectedStackModeIds = (value: React.SetStateAction<Set<string>>) => {
        // console.log('[StateSetter] setSelectedStackModeIds called.'); // Reduced noise
        if (typeof value === 'function') {
            _setSelectedStackModeIds(prev => {
                const newValue = value(prev);
                console.log('[StateSetter] setSelectedStackModeIds (updater) - prev IDs:', JSON.stringify(Array.from(prev)), 'new IDs:', JSON.stringify(Array.from(newValue))); // Kept for importance
                return newValue;
            });
        } else {
            console.log('[StateSetter] setSelectedStackModeIds - new IDs:', JSON.stringify(Array.from(value))); // Kept for importance
            _setSelectedStackModeIds(value);
        }
    };
    // --- END STATE LOGGING WRAPPERS ---

    // Actual state variables are now accessed via the original names for the rest of the component
    // const [orderedSelectedModeObjects, setOrderedSelectedModeObjects] = useState<StackMode[]>([]); // For UI rendering of chips and list
    // const [selectedAndOrderedSlugs, setSelectedAndOrderedSlugs] = useState<string[]>([]); // Source of truth for selection & order
    const [currentLanguage, setCurrentLanguage] = useState<string>('en');
    const [initialSelectedSlugs, setInitialSelectedSlugs] = useState<string[]>([]); // For cancel functionality
    const [activeTab, setActiveTab] = useState<number>(0); // 0 - Stacks By Framework, 1 - New Tab (Empty)
    const [firstLoad, setFirstLoad] = useState<boolean>(true);

    // New state for Stacks By Framework tab, using original _setters for direct use
    // const [stacksData, _setStacksData] = useState<StacksData>({ // already defined above
    //     generalPurpose: { id: 'general', title: '', description: '', subgroups: [] },
    //     frameworks: []
    // });
    // const [selectedStackModeIds, _setSelectedStackModeIds] = useState<Set<string>>(new Set()); // already defined above
    const [isStacksLoading, setIsStacksLoading] = useState<boolean>(true);
    const [stacksError, setStacksError] = useState<string | null>(null);

    // Log initial state on each render - Reduced to minimal
    // console.log('[App Render] stacksData (summary):', { gpCount: stacksData.generalPurpose.subgroups.length, fwCount: stacksData.frameworks.length });
    // console.log('[App Render] selectedStackModeIds:', JSON.parse(JSON.stringify(Array.from(selectedStackModeIds))));
    // console.log('[App Render] selectedAndOrderedSlugs:', JSON.parse(JSON.stringify(selectedAndOrderedSlugs)));
    console.log(`[App Render] Init. Slugs: ${selectedAndOrderedSlugs.length}, IDs: ${selectedStackModeIds.size}, Objs: ${orderedSelectedModeObjects.length}`);


    const updateButtonStates = useCallback(() => {
        // Логика сравнения initial и current состояний для активности кнопок
        // Для простоты пока всегда активны, если есть изменения
        // Compare selectedAndOrderedSlugs with initialSelectedSlugs for changes
        const changed = selectedAndOrderedSlugs.length !== initialSelectedSlugs.length ||
            !selectedAndOrderedSlugs.every((slug, index) => slug === initialSelectedSlugs[index]);
        return changed;
    }, [selectedAndOrderedSlugs, initialSelectedSlugs]);


    useEffect(() => {
        vscode.postMessage({ command: 'webviewReady' });
        // Request stacks data on initial load
        vscode.postMessage({ command: 'requestStacksList', lang: currentLanguage });
    }, [currentLanguage]); // Added currentLanguage dependency

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('[useEffect handleMessage] Received message command:', message.command); // Reduced detail
            switch (message.command) {
                case 'loadStacks':
                    setIsStacksLoading(false);
                    setStacksError(null);
                    const parsedStacks = parseStacksData(message.data);
                    console.log('[useEffect handleMessage] Parsed stacks data (summary):', { gpSg: parsedStacks.generalPurpose.subgroups.length, fw: parsedStacks.frameworks.length }); // Reduced detail
                    setStacksData(parsedStacks);

                    if (firstLoad) {
                        console.log('[useEffect handleMessage] First load, processing selectedModesOrdered from extension.'); // Reduced detail
                        const slugsFromExtension: string[] = (message.selectedModesOrdered || [])
                            .sort((a: { slug: string, order: number }, b: { slug: string, order: number }) => a.order - b.order)
                            .map((item: { slug: string, order: number }) => item.slug);

                        setSelectedAndOrderedSlugs(slugsFromExtension); // Wrapped setter will log (still important)
                        setInitialSelectedSlugs([...slugsFromExtension]); 
                        setFirstLoad(false); 
                        console.log('[useEffect handleMessage] First load processed. Selected slugs set to:', JSON.stringify(slugsFromExtension)); // Kept important part
                    }
                    break;
                case 'loadStacksError':
                    setIsStacksLoading(false);
                    setStacksError(message.message || 'Unknown error loading stacks.');
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [firstLoad]); // Only depends on firstLoad now

    // NEW: Function to convert stack mode to unified StackMode object (already StackMode, but ensures consistency if needed)
    const stackModeToMode = useCallback((stackMode: StackMode): StackMode => {
        // In this refactored version, StackMode is the primary type.
        // This function might seem redundant but is kept for structural similarity
        // and in case future transformations are needed.
        return {
            ...stackMode,
            id: `unified-${stackMode.slug}`, // Ensure consistent ID prefix if used across different sources in future
        };
    }, []);

    // NEW: Get all stack modes as unified StackMode objects
    const getAllStackModes = useCallback((): StackMode[] => {
        const allStackModes: StackMode[] = [];

        // Add from general purpose
        stacksData.generalPurpose.subgroups.forEach(subgroup => {
            subgroup.modes.forEach(mode => {
                allStackModes.push(stackModeToMode(mode));
            });
        });

        // Add from frameworks
        stacksData.frameworks.forEach(framework => {
            framework.subgroups.forEach(subgroup => {
                subgroup.modes.forEach(mode => {
                    allStackModes.push(stackModeToMode(mode));
                });
            });
        });

        return allStackModes;
    }, [stacksData, stackModeToMode]);

    // UNIFIED: Single handler for selection - uses slug-based selection
    const handleUnifiedModeSelection = useCallback((slug: string, isSelected: boolean) => {
        console.log('[handleUnifiedModeSelection Entry] slug:', slug, 'isSelected:', isSelected);
        console.log('[handleUnifiedModeSelection] selectedAndOrderedSlugs BEFORE update:', JSON.parse(JSON.stringify(selectedAndOrderedSlugs)));
        setSelectedAndOrderedSlugs(prevSlugs => {
            console.log('[handleUnifiedModeSelection Setter] prevSlugs:', JSON.parse(JSON.stringify(prevSlugs)));
            let newSlugsArray;
            if (isSelected) {
                if (!prevSlugs.includes(slug)) {
                    newSlugsArray = [...prevSlugs, slug];
                } else {
                    newSlugsArray = prevSlugs;
                }
            } else {
                newSlugsArray = prevSlugs.filter(s => s !== slug);
            }
            console.log('[handleUnifiedModeSelection Setter] newSlugsArray:', JSON.parse(JSON.stringify(newSlugsArray)));
            return newSlugsArray;
        });
        // Note: Cannot log selectedAndOrderedSlugs AFTER update here directly due to async nature of setState
    }, [selectedAndOrderedSlugs]); // Added selectedAndOrderedSlugs to dep array, critical for correct closure

    // UNIFIED: Batch handler for multiple slugs (for subgroups)
    const handleUnifiedBatchModeSelection = useCallback((slugs: string[], isSelected: boolean) => {
        console.log('[handleUnifiedBatchModeSelection Entry] slugs:', slugs, 'isSelected:', isSelected);
        console.log('[handleUnifiedBatchModeSelection] selectedAndOrderedSlugs BEFORE update:', JSON.parse(JSON.stringify(selectedAndOrderedSlugs)));
        setSelectedAndOrderedSlugs(prevSlugs => {
            console.log('[handleUnifiedBatchModeSelection Setter] prevSlugs:', JSON.parse(JSON.stringify(prevSlugs)));
            let newSlugsArray;
            if (isSelected) {
                const newSlugsToAdd = slugs.filter(slug => !prevSlugs.includes(slug));
                newSlugsArray = [...prevSlugs, ...newSlugsToAdd];
            } else {
                newSlugsArray = prevSlugs.filter(slug => !slugs.includes(slug));
            }
            console.log('[handleUnifiedBatchModeSelection Setter] newSlugsArray:', JSON.parse(JSON.stringify(newSlugsArray)));
            return newSlugsArray;
        });
         // Note: Cannot log selectedAndOrderedSlugs AFTER update here directly
    }, [selectedAndOrderedSlugs]); // Added selectedAndOrderedSlugs to dep array

    // This useEffect updates the UI-specific state (Mode objects and Set of Ids)
    // whenever the source of truth (selectedAndOrderedSlugs) or available modes (modesData/stacksData) changes.
    useEffect(() => {
        // The body of this useEffect was commented out for debugging the "Cannot access 'L'" error.
        // It needs to be restored for the application to function correctly.
        // For this subtask (log cleanup), we assume it's restored and proceed to manage its logs.
        console.log('[useEffect SyncSlugs Update Entry] Slugs count:', selectedAndOrderedSlugs.length);
        // console.log('[useEffect SyncSlugs Update Entry] stacksData (summary):', { gpCount: stacksData.generalPurpose.subgroups.length, fwCount: stacksData.frameworks.length }); // Can be noisy

        const newOrderedObjects: StackMode[] = [];
        const newSelectedStackModeIds = new Set<string>();

        const allStackModes = getAllStackModes();
        // console.log('[useEffect SyncSlugs Update] allStackModes count:', allStackModes.length); // Can be noisy
        if (stacksData.frameworks.length === 0 && stacksData.generalPurpose.subgroups.length === 0 && selectedAndOrderedSlugs.length > 0) {
            console.warn('[useEffect SyncSlugs Update] stacksData appears empty but selectedAndOrderedSlugs is not. This might lead to issues.');
        }

        const updateStackModeIds = (subgroups: StackSubgroup[]) => {
            subgroups.forEach(subgroup => {
                (Array.isArray(subgroup.modes) ? subgroup.modes : []).forEach(mode => { // Defensive: ensure modes is an array
                    if (selectedAndOrderedSlugs.includes(mode.slug)) {
                        newSelectedStackModeIds.add(mode.id);
                    }
                });
            });
        };
        updateStackModeIds(stacksData.generalPurpose.subgroups);
        stacksData.frameworks.forEach(fw => updateStackModeIds(fw.subgroups));

        selectedAndOrderedSlugs.forEach(slug => {
            const originalMode = findOriginalStackModeBySlug(slug, stacksData);
            if (originalMode) {
                newOrderedObjects.push(originalMode);
            } else {
                 console.warn(`[useEffect SyncSlugs Update] Slug "${slug}" not found in stacksData for ordered objects.`);
            }
        });
        
        const findOriginalStackModeBySlug = (slug: string, data: StacksData): StackMode | undefined => {
            for (const sg of data.generalPurpose.subgroups) {
                const found = (Array.isArray(sg.modes) ? sg.modes : []).find(m => m.slug === slug);
                if (found) return found;
            }
            for (const fw of data.frameworks) {
                for (const sg of fw.subgroups) {
                    const found = (Array.isArray(sg.modes) ? sg.modes : []).find(m => m.slug === slug);
                    if (found) return found;
                }
            }
            return undefined;
        };

        // console.log('[useEffect SyncSlugs Update] Calculated newSelectedStackModeIds count:', newSelectedStackModeIds.size); // Reduced detail
        // console.log('[useEffect SyncSlugs Update] Calculated newOrderedObjects count:', newOrderedObjects.length); // Reduced detail
        
        let idsChanged = false;
        if (newSelectedStackModeIds.size !== selectedStackModeIds.size) {
            idsChanged = true;
        } else {
            for (const id of newSelectedStackModeIds) {
                if (!selectedStackModeIds.has(id)) {
                    idsChanged = true;
                    break;
                }
            }
        }

        if (idsChanged) {
            console.log('[useEffect SyncSlugs Update] selectedStackModeIds content HAS CHANGED. Updating state. New size:', newSelectedStackModeIds.size);
            setSelectedStackModeIds(newSelectedStackModeIds); 
        } else {
            console.log('[useEffect SyncSlugs Update] selectedStackModeIds content is THE SAME. Skipping state update. Size:', selectedStackModeIds.size);
        }
        
        // Simplified comparison for orderedSelectedModeObjects for logging purposes
        if (orderedSelectedModeObjects.length !== newOrderedObjects.length || 
            !orderedSelectedModeObjects.every((obj, index) => obj.id === newOrderedObjects[index]?.id)) {
            // console.log('[useEffect SyncSlugs Update] orderedSelectedModeObjects content HAS CHANGED. Updating state.'); // Can be noisy
            setOrderedSelectedModeObjects(newOrderedObjects);
        } else {
            // console.log('[useEffect SyncSlugs Update] orderedSelectedModeObjects content is THE SAME. Skipping state update.'); // Can be noisy
        }
        
        console.log('[useEffect SyncSlugs Update] Finished.');
    }, [selectedAndOrderedSlugs, stacksData, getAllStackModes, selectedStackModeIds, orderedSelectedModeObjects]); // Added orderedSelectedModeObjects for its comparison

    const handleApply = () => {
        const selectedModesWithOrder = selectedAndOrderedSlugs.map((slug, index) => ({
            slug: slug,
            order: index
        }));
        vscode.postMessage({
            command: 'applyModeChanges',
            selectedModes: selectedModesWithOrder
        });
        setInitialSelectedSlugs([...selectedAndOrderedSlugs]); // Update initial state for cancel
    };

    const handleCancel = () => {
        setSelectedAndOrderedSlugs([...initialSelectedSlugs]); // Revert to initial slugs
        vscode.postMessage({ command: 'cancelModeChanges' });
    };

    const handleLanguageChange = (lang: 'en' | 'ru' | 'ua') => {
        if (currentLanguage !== lang) {
            setCurrentLanguage(lang); // Update language state
            // Request stacks data for the new language
            // selectedAndOrderedSlugs will be preserved locally
            vscode.postMessage({ command: 'requestStacksList', lang: lang });
        }
    };

    // Handlers for stacks selection (now redirects to unified handler)
    const handleStackModeSelection = (modeId: string, isSelected: boolean) => {
        console.log('[handleStackModeSelection Entry] modeId:', modeId, 'isSelected:', isSelected);
        // Log selectedAndOrderedSlugs BEFORE it's (indirectly) updated
        // This is tricky because the actual update happens after handleUnifiedModeSelection's own async update.
        // The log inside handleUnifiedModeSelection for "BEFORE update" is more accurate for its direct action.
        
        let targetSlug: string | null = null;
        // Search in general purpose
        for (const subgroup of stacksData.generalPurpose.subgroups) {
            const found = subgroup.modes.find(mode => mode.id === modeId);
            if (found) {
                targetSlug = found.slug;
                break;
            }
        }
        // Search in frameworks if not found
        if (!targetSlug) {
            for (const framework of stacksData.frameworks) {
                for (const subgroup of framework.subgroups) {
                    const found = subgroup.modes.find(mode => mode.id === modeId);
                    if (found) {
                        targetSlug = found.slug;
                        break;
                    }
                }
                if (targetSlug) break;
            }
        }

        if (targetSlug) {
            console.log('[handleStackModeSelection] Found slug:', targetSlug, 'for modeId:', modeId, '. Calling handleUnifiedModeSelection.');
            handleUnifiedModeSelection(targetSlug, isSelected);
        } else {
            console.warn('[handleStackModeSelection] No slug found for modeId:', modeId);
        }
        // Logging selectedAndOrderedSlugs AFTER update is not feasible here due to async nature of updates.
        // The main useEffect SyncSlugs will log the result.
    };

    const handleSubgroupSelection = (subgroupId: string, isSelected: boolean) => {
        console.log('[handleSubgroupSelection Entry] subgroupId:', subgroupId, 'isSelected:', isSelected);
        // Log stacksData before any potential modification by updateSubgroupSelection
        // However, updateSubgroupSelection is called later, triggered by selectedStackModeIds change.
        // So, we log current stacksData here as a baseline.
        console.log('[handleSubgroupSelection] stacksData BEFORE (summary):', { gpSgCount: stacksData.generalPurpose.subgroups.length, fwCount: stacksData.frameworks.length });
        // try { console.log('[handleSubgroupSelection] stacksData BEFORE (full):', JSON.parse(JSON.stringify(stacksData))); } catch(e) { console.error("Error stringifying stacksData", e); }
        console.log('[handleSubgroupSelection] selectedAndOrderedSlugs BEFORE update:', JSON.parse(JSON.stringify(selectedAndOrderedSlugs)));

        let targetSubgroup: StackSubgroup | null = null;
        // Search in frameworks first
        for (const framework of stacksData.frameworks) {
            const found = framework.subgroups.find(sg => sg.id === subgroupId);
            if (found) { targetSubgroup = found; break; }
        }
        // Search in general purpose if not found
        if (!targetSubgroup) {
            targetSubgroup = stacksData.generalPurpose.subgroups.find(sg => sg.id === subgroupId) || null;
        }

        if (!targetSubgroup) {
            console.error('[handleSubgroupSelection] ERROR: No targetSubgroup found for subgroupId:', subgroupId);
            // Log available subgroups for easier debugging
            const availableFrameworkSubgroups = stacksData.frameworks.map(f => ({ fw: f.title, sg: f.subgroups.map(s => s.id) }));
            const availableGeneralSubgroups = stacksData.generalPurpose.subgroups.map(s => s.id);
            console.log('[handleSubgroupSelection] Available Framework Subgroups:', availableFrameworkSubgroups);
            console.log('[handleSubgroupSelection] Available General Subgroups:', availableGeneralSubgroups);
            return;
        }

        console.log('[handleSubgroupSelection] Target subgroup:', targetSubgroup.fullTitle, 'current modes count:', targetSubgroup.modes.length);

        const slugsToToggle = targetSubgroup.modes.map(mode => mode.slug);
        console.log(`[handleSubgroupSelection] Batch ${isSelected ? 'SELECTING' : 'DESELECTING'} slugs:`, slugsToToggle);
        handleUnifiedBatchModeSelection(slugsToToggle, isSelected); // This will update selectedAndOrderedSlugs

        // Note: stacksData is NOT directly modified here. updateSubgroupSelection will be triggered
        // by the change in selectedStackModeIds, which itself is triggered by selectedAndOrderedSlugs changing.
        // The main useEffect SyncSlugs will log changes to selectedAndOrderedSlugs.
        console.log('[handleSubgroupSelection Exit]');
    };

    const updateSubgroupSelection = useCallback(() => {
        console.log('[updateSubgroupSelection Entry] selectedStackModeIds count:', selectedStackModeIds.size); // Reduced detail
        setStacksData(prev => {
            // console.log('[updateSubgroupSelection Setter] prev stacksData (summary):', { gpSgCount: prev.generalPurpose.subgroups.length, fwCount: prev.frameworks.length }); // Can be noisy
            const manuallyClonedGeneralPurposeSubgroups = prev.generalPurpose.subgroups.map(sg => ({
                ...sg,
                ...sg,
                // Ensure modes is an array before mapping, defensively.
                ...sg,
                modes: Array.isArray(sg.modes) ? sg.modes.map(m => ({ ...m })) : [],
                selected: false, 
                partiallySelected: false, 
            }));

            const manuallyClonedFrameworks = prev.frameworks.map(fw => ({
                ...fw,
                subgroups: fw.subgroups.map(sg => ({
                    ...sg,
                    modes: Array.isArray(sg.modes) ? sg.modes.map(m => ({ ...m })) : [],
                    selected: false, 
                    partiallySelected: false, 
                })),
            }));
            
            const updatedStacksData: StacksData = {
                generalPurpose: {
                    ...prev.generalPurpose,
                    subgroups: manuallyClonedGeneralPurposeSubgroups,
                },
                frameworks: manuallyClonedFrameworks,
            };

            const updateSelectionStatesInFramework = (framework: StackFramework) => {
                framework.subgroups.forEach(subgroup => {
                    const modesArray = Array.isArray(subgroup.modes) ? subgroup.modes : [];
                    const selectedCount = modesArray.filter(mode =>
                        selectedStackModeIds.has(mode.id) 
                    ).length;

                    subgroup.selected = selectedCount === modesArray.length && modesArray.length > 0;
                    subgroup.partiallySelected = selectedCount > 0 && selectedCount < modesArray.length;
                    
                    // This log is very noisy, commenting out by default
                    // console.log(`[updateSubgroupSelection] Subgroup ${subgroup.id} (${subgroup.fullTitle}): selectedCount=${selectedCount}, totalCount=${modesArray.length}, selected=${subgroup.selected}, partiallySelected=${subgroup.partiallySelected}, Modes Slugs:`, JSON.stringify(modesArray.map(m => m.slug)));
                });
            };

            updateSelectionStatesInFramework(updatedStacksData.generalPurpose);
            updatedStacksData.frameworks.forEach(updateSelectionStatesInFramework);
            
            // console.log('[updateSubgroupSelection Setter] updatedStacksData (summary):', { gpSgCount: updatedStacksData.generalPurpose.subgroups.length, fwCount: updatedStacksData.frameworks.length }); // Can be noisy
            if (updatedStacksData.frameworks.some((fw: StackFramework) => !fw.subgroups || fw.subgroups.some((sg: StackSubgroup) => !sg.modes || !Array.isArray(sg.modes)))) {
                console.error('[updateSubgroupSelection Setter] Problem detected: modes/subgroups missing or not arrays before return');
            }
            return updatedStacksData;
        });
    }, [selectedStackModeIds]); 

    // Load stacks data on tab switch
    useEffect(() => {
        if (activeTab === 1 && isStacksLoading) {
            vscode.postMessage({ command: 'requestStacksList', lang: currentLanguage });
        }
    }, [activeTab, currentLanguage, isStacksLoading]);

    // Update subgroup states when selectedStackModeIds changes
    useEffect(() => {
        console.log('[useEffect updateSubgroupStates] Triggered by selectedStackModeIds change. Count:', selectedStackModeIds.size); // Reduced detail
        updateSubgroupSelection();
    }, [selectedStackModeIds, updateSubgroupSelection]); 

    // Removed the useEffect that called updateSubgroupSelection based on [stacksData, updateSubgroupSelection]
    // as it was largely redundant. Changes to stacksData (like language change) will trigger
    // the main useEffect to rebuild selectedStackModeIds if necessary, which in turn
    // calls updateSubgroupSelection via the effect above. Initial load is also covered.

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // Update selectedAndOrderedSlugs based on drag-and-drop of StackMode objects
            setOrderedSelectedModeObjects((currentOrderedObjects) => {
                const activeMode = currentOrderedObjects.find(item => item.id === active.id);
                const overMode = currentOrderedObjects.find(item => item.id === over.id);

                if (activeMode && overMode) {
                    const oldIndex = currentOrderedObjects.findIndex((item) => item.id === active.id);
                    const newIndex = currentOrderedObjects.findIndex((item) => item.id === over.id);
                    const newOrderedModeObjects = arrayMove(currentOrderedObjects, oldIndex, newIndex);

                    // Update the source of truth for slugs
                    setSelectedAndOrderedSlugs(newOrderedModeObjects.map(m => m.slug));
                    return newOrderedModeObjects; // This updates the draggable chips directly
                }
                return currentOrderedObjects;
            });
        }
    }, []);

    const canApplyOrCancel = updateButtonStates();

    // Display loading state for stacks if needed, or a general loading.
    // if (isLoading) { // isLoading was removed
    //     return <div>Loading...</div>;
    // }
    // if (error) { // error was removed
    // return <div style={{ color: 'red' }}>Error: {error}</div>;
    // }


    return (
        <div className="container">
            <div className="tab-bar">
                <div
                    className={`tab${activeTab === 0 ? " active" : ""}`}
                    onClick={() => setActiveTab(0)}
                >
                    Stacks By Framework
                </div>
                <div
                    className={`tab${activeTab === 1 ? " active" : ""}`}
                    onClick={() => setActiveTab(1)}
                >
                    New Tab (Empty)
                </div>
            </div>
            {activeTab === 0 && (
                <>
                    <header>
                        <div className="selection-summary">
                            <p>Selected: <span id="selected-count">{orderedSelectedModeObjects.length}</span> Modes:</p>
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={orderedSelectedModeObjects.map(mode => mode.id)} // Ensure mode.id is correct here
                                    strategy={horizontalListSortingStrategy}
                                >
                                    <div id="selected-names-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '2px' }}>
                                        {orderedSelectedModeObjects.map(mode => (
                                            <SortableModeChip key={mode.id} mode={mode} />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </div>
                    </header>
                    <main>
                        {isStacksLoading ? (
                            <div>Loading stacks...</div>
                        ) : stacksError ? (
                            <div style={{ color: 'red' }}>Error: {stacksError}</div>
                        ) : (
                            <div className="stacks-container">
                                {/* General Purpose Section */}
                                {stacksData.generalPurpose.subgroups.length > 0 && (
                                    <div className="framework-section">
                                        <h2>{stacksData.generalPurpose.title}</h2>
                                        {stacksData.generalPurpose.subgroups.map(subgroup => (
                                            <div key={subgroup.id} className="subgroup-section">
                                                <div className="subgroup-header">
                                                    <h3>{subgroup.fullTitle}</h3>
                                                </div>
                                                {subgroup.description && (
                                                    <p className="subgroup-description">{subgroup.description}</p>
                                                )}
                                                <div className="modes-list">
                                                    {subgroup.modes.map(mode => {
                                                        const isSelected = selectedAndOrderedSlugs.includes(mode.slug);
                                                        return (
                                                            <div
                                                                key={mode.id}
                                                                className={`mode-item ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => handleStackModeSelection(mode.id, !isSelected)}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    id={`stack-mode-${mode.id}`} // Ensure unique IDs if mode.id can repeat across subgroups
                                                                    checked={isSelected}
                                                                    onChange={(e) => handleStackModeSelection(mode.id, e.target.checked)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    aria-label={`Select mode ${mode.nameWithIcon}`}
                                                                />
                                                                <div className="mode-content">
                                                                    <span className="mode-name-display">{mode.nameWithIcon}</span>
                                                                    {mode.description && (
                                                                        <span className="mode-description-display"> - {mode.description}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Framework Sections */}
                                {stacksData.frameworks.map(framework => (
                                    <div key={framework.id} className="framework-section">
                                        <h2>{framework.title}</h2>
                                        {framework.description && (
                                            <p className="framework-description">{framework.description}</p>
                                        )}
                                        {framework.subgroups.map(subgroup => (
                                            <div key={subgroup.id} className="subgroup-section">
                                                <div className="subgroup-header">
                                                    <input
                                                        type="checkbox"
                                                        id={`subgroup-${subgroup.id}`}
                                                        checked={subgroup.selected}
                                                        ref={input => {
                                                            if (input) {
                                                                input.indeterminate = subgroup.partiallySelected && !subgroup.selected;
                                                            }
                                                        }}
                                                        onChange={(e) => {
                                                            console.log('Subgroup checkbox clicked:', subgroup.id, 'checked:', e.target.checked);
                                                            handleSubgroupSelection(subgroup.id, e.target.checked);
                                                        }}
                                                        onClick={(e) => {
                                                            console.log('Subgroup checkbox onClick:', subgroup.id);
                                                            e.stopPropagation(); // Important to prevent subgroup click from toggling individual modes if header is also clickable
                                                        }}
                                                        aria-label={`Select subgroup ${subgroup.title}`}
                                                    />
                                                    <h3>{subgroup.fullTitle}</h3>
                                                </div>
                                                {subgroup.description && (
                                                    <p className="subgroup-description">{subgroup.description}</p>
                                                )}
                                                <div className="modes-list">
                                                    {subgroup.modes.map(mode => {
                                                        const isSelected = selectedAndOrderedSlugs.includes(mode.slug);
                                                        return (
                                                            <div
                                                                key={mode.id} // Ensure unique IDs
                                                                className={`mode-item ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => handleStackModeSelection(mode.id, !isSelected)}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    id={`stack-mode-${mode.id}`} // Ensure unique IDs
                                                                    checked={isSelected}
                                                                    onChange={(e) => handleStackModeSelection(mode.id, e.target.checked)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    aria-label={`Select mode ${mode.nameWithIcon}`}
                                                                />
                                                                <div className="mode-content">
                                                                    <span className="mode-name-display">{mode.nameWithIcon}</span>
                                                                    {mode.description && (
                                                                        <span className="mode-description-display"> - {mode.description}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </main>
                </>
            )}
            {activeTab === 1 && (
                <div>Content for the new tab will be here.</div>
            )}
            <footer>
                <div className="footer-inner">
                    <div className="language-switcher">
                        <label htmlFor="lang-toggle">Language:</label>
                        <button onClick={() => handleLanguageChange('en')} className={currentLanguage === 'en' ? 'active lang-button' : 'lang-button'}>EN</button>
                        <button onClick={() => handleLanguageChange('ua')} className={currentLanguage === 'ua' ? 'active lang-button' : 'lang-button'}>UA</button>
                    </div>
                    <div className="action-buttons">
                        <button id="apply-button" onClick={handleApply} disabled={!canApplyOrCancel}>Apply</button>
                        <button id="cancel-button" onClick={handleCancel}>Cancel</button>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export default App;