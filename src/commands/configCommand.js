import { createAppContext } from './context.js';

export function setConfigCommand(key, value) {
  const { db, configService } = createAppContext();

  try {
    const result = configService.set(key, value);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

export function getConfigCommand() {
  const { db, configService } = createAppContext();

  try {
    console.table(configService.getAll());
  } finally {
    db.close();
  }
}
