import React from 'react';
import { Layout, Model } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import { AppProvider } from './context/AppContext';
import { DatabaseProvider } from './context/DatabaseContext';
import { FilterProvider } from './context/FilterContext';
import ModuleTreemap from './components/ModuleTreemap';
import FunctionTreemap from './components/FunctionTreemap';
import BasicBlockTreemap from './components/BasicBlockTreemap';
import CallGraph from './components/CallGraph';
import DetailPane from './components/DetailPane';
import './electron-bridge';

// Define the layout model
const json = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    splitterSize: 8,
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'column',
        weight: 25,
        children: [
          {
            type: 'tabset',
            weight: 33,
            children: [
              {
                type: 'tab',
                name: 'Modules',
                component: 'modules',
              },
            ],
          },
          {
            type: 'tabset',
            weight: 33,
            children: [
              {
                type: 'tab',
                name: 'Functions',
                component: 'functions',
              },
            ],
          },
          {
            type: 'tabset',
            weight: 34,
            children: [
              {
                type: 'tab',
                name: 'Basic Blocks',
                component: 'basicblocks',
              },
            ],
          },
        ],
      },
      {
        type: 'column',
        weight: 75,
        children: [
          {
            type: 'tabset',
            weight: 70,
            children: [
              {
                type: 'tab',
                name: 'Call Graph',
                component: 'callgraph',
              },
            ],
          },
          {
            type: 'tabset',
            weight: 30,
            children: [
              {
                type: 'tab',
                name: 'Details',
                component: 'details',
              },
            ],
          },
        ],
      },
    ],
  },
};

const model = Model.fromJson(json);

function App() {
  const factory = (node) => {
    const component = node.getComponent();

    switch (component) {
      case 'modules':
        return <ModuleTreemap />;
      case 'functions':
        return <FunctionTreemap />;
      case 'basicblocks':
        return <BasicBlockTreemap />;
      case 'callgraph':
        return <CallGraph />;
      case 'details':
        return <DetailPane />;
      default:
        return <div>Unknown component: {component}</div>;
    }
  };

  return (
    <DatabaseProvider>
      <FilterProvider>
        <AppProvider>
          <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
              <Layout model={model} factory={factory} />
            </div>
          </div>
        </AppProvider>
      </FilterProvider>
    </DatabaseProvider>
  );
}

export default App;
